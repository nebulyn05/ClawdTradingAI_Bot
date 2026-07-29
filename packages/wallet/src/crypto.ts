import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { loadConfig } from "@clawd/core";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

export interface Sealed {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function getMasterKey(): Buffer {
  const { MASTER_ENCRYPTION_KEY } = loadConfig();
  if (!MASTER_ENCRYPTION_KEY) {
    throw new Error(
      "MASTER_ENCRYPTION_KEY is not set. Generate one with: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return Buffer.from(MASTER_ENCRYPTION_KEY, "hex");
}

/** Encrypts `plaintext` with `key` (must be 32 bytes) using AES-256-GCM. */
export function seal(plaintext: Buffer, key: Buffer): Sealed {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

/** Decrypts a value produced by `seal` with the same `key`. */
export function unseal(sealed: Sealed, key: Buffer): Buffer {
  const decipher = createDecipheriv(ALGO, key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]);
}

/** Wraps a per-wallet data key with the server master key. */
export function wrapDataKey(dataKey: Buffer): { wrapped: string; wrapIv: string; wrapAuthTag: string } {
  const sealed = seal(dataKey, getMasterKey());
  return { wrapped: sealed.ciphertext, wrapIv: sealed.iv, wrapAuthTag: sealed.authTag };
}

/** Unwraps a data key that was wrapped by `wrapDataKey`. */
export function unwrapDataKey(wrapped: string, wrapIv: string, wrapAuthTag: string): Buffer {
  return unseal({ ciphertext: wrapped, iv: wrapIv, authTag: wrapAuthTag }, getMasterKey());
}

export function generateDataKey(): Buffer {
  return randomBytes(32);
}
