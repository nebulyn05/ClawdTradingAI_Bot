import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import type { KeyMaterial } from "./types.js";

export type { KeyMaterial };

/** Generates a new Solana keypair. `rawKey` is the base58-encoded 64-byte secret key. */
export function generateSolanaKey(): KeyMaterial {
  const kp = Keypair.generate();
  return { address: kp.publicKey.toBase58(), rawKey: bs58.encode(kp.secretKey) };
}

/** Imports a base58-encoded secret key, validating it decodes to a real keypair. */
export function importSolanaKey(rawKey: string): KeyMaterial {
  let secretKey: Uint8Array;
  try {
    secretKey = bs58.decode(rawKey.trim());
  } catch {
    throw new Error("Invalid Solana private key: not valid base58");
  }
  if (secretKey.length !== 64) {
    throw new Error("Invalid Solana private key: expected a 64-byte secret key");
  }
  const kp = Keypair.fromSecretKey(secretKey);
  return { address: kp.publicKey.toBase58(), rawKey };
}
