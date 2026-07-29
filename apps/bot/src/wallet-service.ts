import { getDb, type Wallet } from "@clawd/db";
import { networkForChain, type Chain, type EncryptedKey } from "@clawd/core";
import {
  createWallet as generateWallet,
  importWallet as importRawWallet,
  exportRawKey,
  hashPassphrase,
  verifyPassphrase,
} from "@clawd/wallet";
import { getChainAdapter, formatNativeAmount, parseNativeAmount } from "@clawd/chains";

export { formatNativeAmount, parseNativeAmount };

/** All 6 chains now have real, working adapters. */
export const SUPPORTED_CHAINS: Chain[] = ["solana", "ethereum", "bsc", "base", "monad", "robinhood"];

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

/** Toggles whether the worker's Sniper/Guard/Router pipeline may trade this wallet. */
export async function setWalletActive(userId: string, chain: Chain, active: boolean) {
  return getDb().wallet.update({
    where: { userId_chain_network: { userId, chain, network: networkForChain(chain) } },
    data: { active },
  });
}

/** Live native-token balance for a user's wallet on `chain`, via that chain's adapter. */
export async function getWalletBalance(userId: string, chain: Chain): Promise<bigint> {
  const wallet = await getDb().wallet.findUniqueOrThrow({
    where: { userId_chain_network: { userId, chain, network: networkForChain(chain) } },
  });
  return getChainAdapter(chain).getBalance(wallet.address);
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
