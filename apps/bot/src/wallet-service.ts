import { getDb, Prisma, type Wallet } from "@clawd/db";
import { networkForChain, getSetting, type Chain, type EncryptedKey } from "@clawd/core";
import {
  createWallet as generateWallet,
  importWallet as importRawWallet,
  exportRawKey,
  generateKeyMaterial,
  encryptExistingKey,
  detectImportMaterial,
  hashPassphrase,
  verifyPassphrase,
} from "@clawd/wallet";
import { getChainAdapter, formatNativeAmount, parseNativeAmount } from "@clawd/chains";

export { formatNativeAmount, parseNativeAmount };

/** All 6 chains now have real, working adapters. */
export const SUPPORTED_CHAINS: Chain[] = ["solana", "ethereum", "bsc", "base", "monad", "robinhood"];

/** EVM-compatible chains — share one address/keypair at onboarding time (see createWalletsForOnboarding). */
const EVM_CHAINS: Chain[] = ["ethereum", "bsc", "base", "monad", "robinhood"];

function toEncryptedKey(wallet: Wallet): EncryptedKey {
  return {
    ciphertext: wallet.encCiphertext,
    authTag: wallet.encAuthTag,
    iv: wallet.encIv,
    wrappedDataKey: wallet.encWrappedDataKey,
    wrapIv: wallet.encWrapIv,
    wrapAuthTag: wallet.encWrapAuthTag,
  };
}

function encryptedKeyColumns(encryptedKey: EncryptedKey) {
  return {
    encCiphertext: encryptedKey.ciphertext,
    encAuthTag: encryptedKey.authTag,
    encIv: encryptedKey.iv,
    encWrappedDataKey: encryptedKey.wrappedDataKey,
    encWrapIv: encryptedKey.wrapIv,
    encWrapAuthTag: encryptedKey.wrapAuthTag,
  };
}

export async function getOrCreateUser(telegramId: string, username?: string) {
  const db = getDb();
  return db.user.upsert({
    where: { telegramId },
    update: { telegramUsername: username },
    create: { telegramId, telegramUsername: username },
  });
}

/** Creates a wallet for every supported chain the user doesn't already have one for. */
export async function ensureWalletsForUser(userId: string) {
  const db = getDb();
  const existing = await db.wallet.findMany({ where: { userId } });
  const existingChains = new Set(existing.map((w) => w.chain));

  const created = [];
  for (const chain of SUPPORTED_CHAINS) {
    if (existingChains.has(chain)) continue;
    const network = networkForChain(chain);
    const { address, encryptedKey } = generateWallet(chain);
    const wallet = await db.wallet.create({
      data: { userId, chain, network, address, ...encryptedKeyColumns(encryptedKey) },
    });
    created.push(wallet);
  }
  return created;
}

export async function listWallets(userId: string) {
  return getDb().wallet.findMany({ where: { userId }, orderBy: { chain: "asc" } });
}

export interface OnboardingWalletResult {
  created: Wallet[];
  /** Raw key material, present only for chains actually created this call — never re-derivable from storage. */
  rawKeys: { evm: string | null; solana: string | null };
}

/**
 * Onboarding-only wallet creation: generates ONE EVM keypair — reused as the
 * same address across every missing EVM chain row, since they're all
 * 0x-hex-compatible — plus one Solana keypair, creating a `Wallet` row per
 * chain exactly as before (every existing per-chain lookup in router/
 * exposure/admin code is unaffected; only the EVM rows happen to share an
 * address and an equivalent decrypted key). Returns the raw keys so the
 * onboarding conversation can show them once, from memory, without ever
 * reading them back out of storage — do not call this outside that flow.
 */
export async function createWalletsForOnboarding(userId: string): Promise<OnboardingWalletResult> {
  const db = getDb();
  const existing = await db.wallet.findMany({ where: { userId } });
  const existingChains = new Set(existing.map((w) => w.chain));

  const created: Wallet[] = [];
  let evmRawKey: string | null = null;
  let solanaRawKey: string | null = null;

  const missingEvmChains = EVM_CHAINS.filter((chain) => !existingChains.has(chain));
  if (missingEvmChains.length > 0) {
    const material = generateKeyMaterial("ethereum"); // any EVM chain generates the same 0x-hex format
    evmRawKey = material.rawKey;
    for (const chain of missingEvmChains) {
      const { address, encryptedKey } = encryptExistingKey(chain, material.address, material.rawKey);
      const wallet = await db.wallet.create({
        data: { userId, chain, network: networkForChain(chain), address, ...encryptedKeyColumns(encryptedKey) },
      });
      created.push(wallet);
    }
  }

  if (!existingChains.has("solana")) {
    const material = generateKeyMaterial("solana");
    solanaRawKey = material.rawKey;
    const { address, encryptedKey } = encryptExistingKey("solana", material.address, material.rawKey);
    const wallet = await db.wallet.create({
      data: { userId, chain: "solana", network: networkForChain("solana"), address, ...encryptedKeyColumns(encryptedKey) },
    });
    created.push(wallet);
  }

  return { created, rawKeys: { evm: evmRawKey, solana: solanaRawKey } };
}

export interface RegeneratedWalletResult {
  wallets: Wallet[];
  rawKeys: { evm: string; solana: string };
  /** The overwritten wallets' raw keys, captured before the update — the only chance to recover funds left in them. Null for a chain family with no prior wallet. */
  previousRawKeys: { evm: string | null; solana: string | null };
}

/**
 * Regenerates this user's wallets — a brand-new EVM keypair (shared across
 * every EVM chain row, same as onboarding) and a brand-new Solana keypair.
 * Updates existing `Wallet` rows IN PLACE (address + encrypted key columns)
 * rather than deleting and recreating them: `Position.walletId` has no
 * delete cascade, so removing a wallet row with trade history would violate
 * that foreign key. Updating in place keeps that history intact under the
 * same row id while pointing it at a fresh address/key. The old address
 * becomes unusable for future deposits — this is destructive, callers MUST
 * gate it behind an explicit confirmation, AND must show previousRawKeys to
 * the user (their only remaining way to recover whatever was left in the
 * overwritten wallet) before this call's own new rawKeys are shown.
 */
export async function regenerateWallet(userId: string): Promise<RegeneratedWalletResult> {
  const db = getDb();
  const existing = await db.wallet.findMany({ where: { userId } });

  const previousEvmWallet = existing.find((w) => w.chain !== "solana");
  const previousSolanaWallet = existing.find((w) => w.chain === "solana");
  const previousRawKeys = {
    evm: previousEvmWallet ? exportRawKey(toEncryptedKey(previousEvmWallet)) : null,
    solana: previousSolanaWallet ? exportRawKey(toEncryptedKey(previousSolanaWallet)) : null,
  };

  const evmMaterial = generateKeyMaterial("ethereum"); // any EVM chain generates the same 0x-hex format
  const solMaterial = generateKeyMaterial("solana");

  const wallets: Wallet[] = [];
  for (const wallet of existing) {
    const material = wallet.chain === "solana" ? solMaterial : evmMaterial;
    const { address, encryptedKey } = encryptExistingKey(wallet.chain, material.address, material.rawKey);
    const updated = await db.wallet.update({
      where: { id: wallet.id },
      data: { address, ...encryptedKeyColumns(encryptedKey) },
    });
    wallets.push(updated);
  }

  return { wallets, rawKeys: { evm: evmMaterial.rawKey, solana: solMaterial.rawKey }, previousRawKeys };
}

/** Imports a user-supplied key for `chain`. Refuses to overwrite an existing wallet for safety. */
export async function importWalletForUser(userId: string, chain: Chain, rawKey: string) {
  const db = getDb();
  const existing = await db.wallet.findUnique({
    where: { userId_chain_network: { userId, chain, network: networkForChain(chain) } },
  });
  if (existing) {
    throw new Error(
      `You already have a ${chain} wallet (${existing.address}). Withdraw funds and remove it before importing a new one.`,
    );
  }
  const { address, encryptedKey } = importRawWallet(chain, rawKey);
  return db.wallet.create({
    data: { userId, chain, network: networkForChain(chain), address, ...encryptedKeyColumns(encryptedKey) },
  });
}

export interface ImportDetectedResult {
  kind: "evm" | "solana" | "mnemonic";
  updatedChains: Chain[];
}

/**
 * Auto-detects the pasted secret's format (EVM hex / Solana base58 or JSON
 * array / mnemonic — see @clawd/wallet's detectImportMaterial) and applies
 * it: an EVM key updates every EVM chain row IN PLACE with the same shared
 * address (matching onboarding's/regenerateWallet's shared-address model —
 * every EVM row gets its own independently-encrypted copy of the same raw
 * key), a Solana key updates the Solana row. Updating in place (not
 * delete+recreate) preserves Position history under the same row id, same
 * reasoning as regenerateWallet. A mnemonic updates both families at once.
 */
export async function importDetectedWallet(userId: string, input: string): Promise<ImportDetectedResult> {
  const detected = detectImportMaterial(input);
  const db = getDb();
  const existing = await db.wallet.findMany({ where: { userId } });
  const updatedChains: Chain[] = [];

  async function applyEvm(material: { address: string; rawKey: string }) {
    for (const wallet of existing.filter((w) => w.chain !== "solana")) {
      const { address, encryptedKey } = encryptExistingKey(wallet.chain, material.address, material.rawKey);
      await db.wallet.update({ where: { id: wallet.id }, data: { address, ...encryptedKeyColumns(encryptedKey) } });
      updatedChains.push(wallet.chain);
    }
  }

  async function applySolana(material: { address: string; rawKey: string }) {
    const wallet = existing.find((w) => w.chain === "solana");
    if (!wallet) return;
    const { address, encryptedKey } = encryptExistingKey("solana", material.address, material.rawKey);
    await db.wallet.update({ where: { id: wallet.id }, data: { address, ...encryptedKeyColumns(encryptedKey) } });
    updatedChains.push("solana");
  }

  if (detected.kind === "evm") {
    await applyEvm(detected.material);
  } else if (detected.kind === "solana") {
    await applySolana(detected.material);
  } else {
    await applyEvm(detected.evm);
    await applySolana(detected.solana);
  }

  return { kind: detected.kind, updatedChains };
}

export async function setExportPassphrase(userId: string, passphrase: string) {
  const exportPassphraseHash = await hashPassphrase(passphrase);
  await getDb().user.update({ where: { id: userId }, data: { exportPassphraseHash } });
}

export async function hasExportPassphrase(userId: string): Promise<boolean> {
  const user = await getDb().user.findUniqueOrThrow({ where: { id: userId } });
  return Boolean(user.exportPassphraseHash);
}

export async function checkExportPassphrase(userId: string, passphrase: string): Promise<boolean> {
  const user = await getDb().user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.exportPassphraseHash) return false;
  return verifyPassphrase(passphrase, user.exportPassphraseHash);
}

/** Decrypts and returns the raw private key for `chain`. Caller MUST have already re-authenticated. */
export async function exportWalletKey(userId: string, chain: Chain): Promise<string> {
  const wallet = await getDb().wallet.findUniqueOrThrow({
    where: { userId_chain_network: { userId, chain, network: networkForChain(chain) } },
  });
  return exportRawKey(toEncryptedKey(wallet));
}

/**
 * Decrypts both key materials at once — the single shared EVM key (read
 * from whichever EVM chain row exists first, since all 5 decrypt to the
 * same value) and the Solana key — matching the reference flow's "reveal
 * everything at once" export screen rather than a per-chain picker, since
 * that's how the two-address wallet model actually works. Caller MUST have
 * already re-authenticated.
 */
export async function exportAllWalletKeys(userId: string): Promise<{ evm: string | null; solana: string | null }> {
  const wallets = await getDb().wallet.findMany({ where: { userId } });
  const evmWallet = wallets.find((w) => w.chain !== "solana");
  const solWallet = wallets.find((w) => w.chain === "solana");
  return {
    evm: evmWallet ? exportRawKey(toEncryptedKey(evmWallet)) : null,
    solana: solWallet ? exportRawKey(toEncryptedKey(solWallet)) : null,
  };
}

/** Toggles whether the worker's Sniper/Guard/Router pipeline may trade this wallet. */
export async function setWalletActive(userId: string, chain: Chain, active: boolean) {
  return getDb().wallet.update({
    where: { userId_chain_network: { userId, chain, network: networkForChain(chain) } },
    data: { active },
  });
}

/** Live native-token balance for a user's wallet on `chain`, via that chain's adapter. */
/**
 * Races `promise` against a timeout, returning `fallback` if the timeout
 * wins. Without this, an unreachable/slow RPC or price endpoint hangs on
 * the OS-level TCP timeout (can be 60s+) — long enough that a Telegram
 * callback query answering it has already expired by the time it resolves,
 * which reads to the user as "nothing happens" when they tap a button.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  // .catch here (not on the race result) so a late rejection from the losing
  // side after the timeout already won doesn't surface as an unhandled
  // rejection — the caller only ever sees `fallback` in that case.
  const guarded = promise.catch(() => fallback);
  return Promise.race([guarded, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

const BALANCE_FETCH_TIMEOUT_MS = 5000;

export async function getWalletBalance(userId: string, chain: Chain): Promise<bigint> {
  const wallet = await getDb().wallet.findUniqueOrThrow({
    where: { userId_chain_network: { userId, chain, network: networkForChain(chain) } },
  });
  return withTimeout(getChainAdapter(chain).getBalance(wallet.address), BALANCE_FETCH_TIMEOUT_MS, 0n);
}

/** Withdraws `amountInput` (human decimal, e.g. "0.5") of the native token to `toAddress`. */
export async function withdrawFromWallet(
  userId: string,
  chain: Chain,
  toAddress: string,
  amountInput: string,
) {
  const wallet = await getDb().wallet.findUniqueOrThrow({
    where: { userId_chain_network: { userId, chain, network: networkForChain(chain) } },
  });
  const amount = parseNativeAmount(chain, amountInput);
  return getChainAdapter(chain).withdraw(toEncryptedKey(wallet), toAddress, amount);
}

const TOKEN_BALANCE_TIMEOUT_MS = 5000;

/** Balance + decimals for an arbitrary token (ERC20 contract / SPL mint address) in this user's wallet on `chain`. */
export async function getTokenBalanceForWallet(
  userId: string,
  chain: Chain,
  tokenAddress: string,
): Promise<{ balance: bigint; decimals: number }> {
  const wallet = await getDb().wallet.findUniqueOrThrow({
    where: { userId_chain_network: { userId, chain, network: networkForChain(chain) } },
  });
  return withTimeout(
    getChainAdapter(chain).getTokenBalance(tokenAddress, wallet.address),
    TOKEN_BALANCE_TIMEOUT_MS,
    { balance: 0n, decimals: 0 },
  );
}

/** Transfers `amount` (already in the token's smallest unit) of an arbitrary token to `toAddress`. */
export async function transferTokenFromWallet(
  userId: string,
  chain: Chain,
  tokenAddress: string,
  toAddress: string,
  amount: bigint,
) {
  const wallet = await getDb().wallet.findUniqueOrThrow({
    where: { userId_chain_network: { userId, chain, network: networkForChain(chain) } },
  });
  return getChainAdapter(chain).transferToken(toEncryptedKey(wallet), tokenAddress, toAddress, amount);
}

export const STABLECOIN_SYMBOLS = ["usdc", "usdt"] as const;
export type StablecoinSymbol = (typeof STABLECOIN_SYMBOLS)[number];

/**
 * Admin-configured contract/mint address for a stablecoin on `chain`
 * (Settings' STABLECOIN_<SYMBOL>_ADDRESS_<CHAIN>), or null if unset. Never
 * hardcoded/guessed — testnet vs mainnet stablecoin addresses differ per
 * chain and we won't fabricate one that might not exist or might be wrong.
 */
export async function getStablecoinAddress(chain: Chain, symbol: StablecoinSymbol): Promise<string | null> {
  return getSetting(`STABLECOIN_${symbol.toUpperCase()}_ADDRESS_${chain.toUpperCase()}`);
}

export interface SlippageSide {
  buyBps: number | null;
  sellBps: number | null;
}

/** Per-chain trading overrides from Settings' Trading section — null fields mean "Auto." */
export async function getWalletOverrides(userId: string, chain: Chain) {
  const wallet = await getDb().wallet.findUniqueOrThrow({
    where: { userId_chain_network: { userId, chain, network: networkForChain(chain) } },
    select: { buyAmountOverride: true, slippageBuyBps: true, slippageSellBps: true },
  });
  return wallet;
}

export async function setBuyAmountOverride(userId: string, chain: Chain, amount: string | null): Promise<void> {
  await getDb().wallet.update({
    where: { userId_chain_network: { userId, chain, network: networkForChain(chain) } },
    data: { buyAmountOverride: amount },
  });
}

export async function setSlippageOverride(
  userId: string,
  chain: Chain,
  side: "buy" | "sell",
  bps: number | null,
): Promise<void> {
  await getDb().wallet.update({
    where: { userId_chain_network: { userId, chain, network: networkForChain(chain) } },
    data: side === "buy" ? { slippageBuyBps: bps } : { slippageSellBps: bps },
  });
}

export interface UserTradingOverrides {
  takeProfitPctOverride: number | null;
  stopLossPctOverride: number | null;
  ruggGuardEnabled: boolean;
  antiMevEnabled: boolean;
  alertsEnabled: boolean;
  languageCode: string;
}

export async function getUserSettings(userId: string): Promise<UserTradingOverrides> {
  return getDb().user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      takeProfitPctOverride: true,
      stopLossPctOverride: true,
      ruggGuardEnabled: true,
      antiMevEnabled: true,
      alertsEnabled: true,
      languageCode: true,
    },
  });
}

export async function updateUserSettings(userId: string, patch: Partial<UserTradingOverrides>): Promise<void> {
  await getDb().user.update({ where: { id: userId }, data: patch });
}

/** Resets every per-user and per-chain override back to "Auto"/defaults. */
export async function resetUserSettings(userId: string): Promise<void> {
  const db = getDb();
  await db.user.update({
    where: { id: userId },
    data: {
      takeProfitPctOverride: null,
      stopLossPctOverride: null,
      ruggGuardEnabled: true,
      antiMevEnabled: true,
      alertsEnabled: true,
    },
  });
  await db.wallet.updateMany({
    where: { userId },
    data: { buyAmountOverride: null, slippageBuyBps: null, slippageSellBps: null },
  });
}

/** Generates a short, human-shareable referral code from the user's own id (deterministic, no collisions to check). */
function deriveReferralCode(userId: string): string {
  return userId.slice(-8).toUpperCase();
}

/** Returns this user's referral code, creating one on first access. */
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const db = getDb();
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } });
  if (user.referralCode) return user.referralCode;

  const code = deriveReferralCode(userId);
  await db.user.update({ where: { id: userId }, data: { referralCode: code } });
  return code;
}

/**
 * Records that `userId` signed up via `referralCode`, if that code exists and
 * isn't the user's own (no self-referral) and they don't already have a
 * referrer (first attribution wins). Silently no-ops otherwise — an invalid
 * or stale referral code shouldn't block onboarding.
 */
export async function attributeReferral(userId: string, referralCode: string): Promise<void> {
  const db = getDb();
  const [user, referrer] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { referredByUserId: true } }),
    db.user.findUnique({ where: { referralCode }, select: { id: true } }),
  ]);
  if (!referrer || referrer.id === userId || user.referredByUserId) return;
  await db.user.update({ where: { id: userId }, data: { referredByUserId: referrer.id } });
}

export interface ReferralStats {
  referralCode: string;
  referralCount: number;
}

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const referralCode = await getOrCreateReferralCode(userId);
  const referralCount = await getDb().user.count({ where: { referredByUserId: userId } });
  return { referralCode, referralCount };
}

/** Replaces the auto-derived referral code with a user-chosen one. Rejects duplicates and invalid formats. */
export async function setCustomReferralCode(userId: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = code.trim().toUpperCase();
  if (!/^[A-Z0-9_]{3,20}$/.test(trimmed)) {
    return { ok: false, error: "Code must be 3-20 characters: letters, numbers, and underscores only." };
  }
  try {
    await getDb().user.update({ where: { id: userId }, data: { referralCode: trimmed } });
    return { ok: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "That code is already taken. Try another." };
    }
    throw err;
  }
}
