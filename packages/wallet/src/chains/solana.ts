import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import type { KeyMaterial } from "./types.js";

export type { KeyMaterial };

/** Generates a new Solana keypair. `rawKey` is the base58-encoded 64-byte secret key. */
export function generateSolanaKey(): KeyMaterial {
  const kp = Keypair.generate();
  return { address: kp.publicKey.toBase58(), rawKey: bs58.encode(kp.secretKey) };
}

/**
 * Imports a Solana secret key in either of the two formats wallet apps
 * export it as: a base58 string (Phantom) or a JSON array of 64 byte values
 * (Solflare/Backpack) — both encode the identical 64-byte secret key, just
 * differently. Always re-encoded to base58 for storage, our one canonical
 * on-disk format regardless of which format was pasted in.
 */
export function importSolanaKey(rawKey: string): KeyMaterial {
  const trimmed = rawKey.trim();
  let secretKey: Uint8Array;

  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Invalid Solana private key: not valid JSON");
    }
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 64 ||
      !parsed.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ) {
      throw new Error("Invalid Solana private key: expected a 64-byte JSON array");
    }
    secretKey = Uint8Array.from(parsed as number[]);
  } else {
    try {
      secretKey = bs58.decode(trimmed);
    } catch {
      throw new Error("Invalid Solana private key: not valid base58");
    }
    if (secretKey.length !== 64) {
      throw new Error("Invalid Solana private key: expected a 64-byte secret key");
    }
  }

  const kp = Keypair.fromSecretKey(secretKey);
  return { address: kp.publicKey.toBase58(), rawKey: bs58.encode(secretKey) };
}
