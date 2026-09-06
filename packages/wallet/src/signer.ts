import type { Chain, EncryptedKey } from "@clawd/core";
import { generateSolanaKey, importSolanaKey } from "./chains/solana.js";
import { generateEvmKey, importEvmKey } from "./chains/evm.js";
import { isValidMnemonic, deriveEvmFromMnemonic, deriveSolanaFromMnemonic } from "./chains/mnemonic.js";
import type { KeyMaterial } from "./chains/types.js";
import { encryptPrivateKey, decryptPrivateKey } from "./envelope.js";

// Monad and Robinhood Chain are EVM-compatible (same 0x-hex key format as
// Ethereum/BSC/Base), so wallet generation/import needs no new code for them.
const EVM_CHAINS: readonly Chain[] = ["ethereum", "bsc", "base", "monad", "robinhood"];

function assertSupported(chain: Chain): void {
  if (chain !== "solana" && !EVM_CHAINS.includes(chain)) {
    throw new Error(`Wallet support for "${chain}" is not implemented.`);
  }
}

export interface CreatedWallet {
  address: string;
  encryptedKey: EncryptedKey;
}

/**
 * Generates fresh key material for `chain` without encrypting it — the raw
 * key is still in memory after this call. Used when a caller needs the same
 * key material more than once (e.g. sharing one EVM keypair's address across
 * several EVM chain rows) or needs to show the raw key once at creation time
 * rather than only via the passphrase-gated export flow.
 */
export function generateKeyMaterial(chain: Chain): KeyMaterial {
  assertSupported(chain);
  return chain === "solana" ? generateSolanaKey() : generateEvmKey();
}

/** Envelope-encrypts already-generated key material for `chain` (no new key generation). */
export function encryptExistingKey(chain: Chain, address: string, rawKey: string): CreatedWallet {
  assertSupported(chain);
  return { address, encryptedKey: encryptPrivateKey(rawKey) };
}

/** Generates a brand-new keypair for `chain` and returns its address plus envelope-encrypted key. */
export function createWallet(chain: Chain): CreatedWallet {
  const material = generateKeyMaterial(chain);
  return encryptExistingKey(chain, material.address, material.rawKey);
}

/** Imports a user-supplied raw private key for `chain`, validating and then envelope-encrypting it. */
export function importWallet(chain: Chain, rawKey: string): CreatedWallet {
  assertSupported(chain);
  const material = chain === "solana" ? importSolanaKey(rawKey) : importEvmKey(rawKey);
  return { address: material.address, encryptedKey: encryptPrivateKey(material.rawKey) };
}

export type DetectedImportMaterial =
  | { kind: "evm"; material: KeyMaterial }
  | { kind: "solana"; material: KeyMaterial }
  | { kind: "mnemonic"; evm: KeyMaterial; solana: KeyMaterial };

/**
 * Auto-detects which of the four formats a pasted secret is (EVM 0x-hex,
 * Solana base58/Phantom, Solana JSON-array/Solflare-Backpack, or a
 * 12/15/18/21/24-word BIP39 mnemonic — the full set of valid BIP39 lengths,
 * not just the common 12/24) — no "which chain?" prompt needed, matching how
 * reference wallet bots accept import material. A mnemonic derives both an
 * EVM and a Solana identity from the same phrase (standard per-chain paths —
 * see chains/mnemonic.ts), since one seed phrase covers both in every
 * multi-chain wallet app a user would be importing from.
 *
 * Returns raw (unencrypted) key material rather than an already-encrypted
 * `CreatedWallet` — an EVM import needs to be re-encrypted once per EVM
 * chain row (see wallet-service.ts's shared-address pattern, same as
 * `generateKeyMaterial`/`encryptExistingKey`), so encryption is the caller's
 * job here, not this function's.
 */
export function detectImportMaterial(input: string): DetectedImportMaterial {
  const trimmed = input.trim();

  if (/^(0x)?[0-9a-fA-F]{64}$/.test(trimmed)) {
    return { kind: "evm", material: importEvmKey(trimmed) };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if ([12, 15, 18, 21, 24].includes(words.length) && isValidMnemonic(trimmed)) {
    return { kind: "mnemonic", evm: deriveEvmFromMnemonic(trimmed), solana: deriveSolanaFromMnemonic(trimmed) };
  }

  if (trimmed.startsWith("[")) {
    return { kind: "solana", material: importSolanaKey(trimmed) };
  }

  try {
    return { kind: "solana", material: importSolanaKey(trimmed) };
  } catch {
    throw new Error(
      "Unrecognized format. Send an EVM private key (0x...), a Solana secret key " +
        "(base58 or JSON array), or a 12/15/18/21/24-word mnemonic phrase.",
    );
  }
}

/**
 * Decrypts `enc` for the duration of `fn` only — used by chain adapters at
 * sign time so the raw private key never escapes this call frame. Prefer
 * this over calling `exportRawKey` anywhere in the trading path.
 */
export async function withDecryptedKey<T>(
  enc: EncryptedKey,
  fn: (rawKey: string) => Promise<T>,
): Promise<T> {
  const rawKey = decryptPrivateKey(enc);
  try {
    return await fn(rawKey);
  } finally {
    // rawKey is a JS string and can't be scrubbed in place; scoping it to this
    // function body is the best mitigation available without native buffers.
  }
}

/**
 * Decrypts and returns the raw private key for the user-facing "export key"
 * flow. Callers MUST have already re-authenticated the user (passphrase
 * check via `verifyPassphrase`) before calling this — it performs no auth
 * itself.
 */
export function exportRawKey(enc: EncryptedKey): string {
  return decryptPrivateKey(enc);
}

export function isEvmChain(chain: Chain): boolean {
  return EVM_CHAINS.includes(chain);
}
