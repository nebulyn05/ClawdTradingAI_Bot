import type { Chain, EncryptedKey } from "@clawd/core";
import { generateSolanaKey, importSolanaKey } from "./chains/solana.js";
import { generateEvmKey, importEvmKey } from "./chains/evm.js";
import { encryptPrivateKey, decryptPrivateKey } from "./envelope.js";

const EVM_CHAINS: readonly Chain[] = ["ethereum", "bsc", "base"];
const UNSUPPORTED_CHAINS: readonly Chain[] = ["monad", "robinhood"];

function assertSupported(chain: Chain): void {
  if (UNSUPPORTED_CHAINS.includes(chain)) {
    throw new Error(
      `Wallet support for "${chain}" is not implemented yet (no verified RPC/SDK integration). ` +
        "See packages/chains/src/monad and /robinhood for the stub adapter.",
    );
  }
}

export interface CreatedWallet {
  address: string;
  encryptedKey: EncryptedKey;
}

/** Generates a brand-new keypair for `chain` and returns its address plus envelope-encrypted key. */
export function createWallet(chain: Chain): CreatedWallet {
  assertSupported(chain);
  const material = chain === "solana" ? generateSolanaKey() : generateEvmKey();
  return { address: material.address, encryptedKey: encryptPrivateKey(material.rawKey) };
}

/** Imports a user-supplied raw private key for `chain`, validating and then envelope-encrypting it. */
export function importWallet(chain: Chain, rawKey: string): CreatedWallet {
  assertSupported(chain);
  const material = chain === "solana" ? importSolanaKey(rawKey) : importEvmKey(rawKey);
  return { address: material.address, encryptedKey: encryptPrivateKey(material.rawKey) };
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
