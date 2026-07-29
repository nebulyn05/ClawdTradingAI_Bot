import type { EncryptedKey } from "@clawd/core";
import { generateDataKey, seal, unseal, wrapDataKey, unwrapDataKey } from "./crypto.js";

/**
 * Envelope-encrypts a raw private key: a fresh random data key encrypts the
 * key material, and the data key itself is wrapped by the server master key.
 * This means rotating the master key only requires re-wrapping data keys,
 * not re-encrypting every private key in the database.
 */
export function encryptPrivateKey(rawKey: string): EncryptedKey {
  const dataKey = generateDataKey();
  const sealed = seal(Buffer.from(rawKey, "utf8"), dataKey);
  const wrapped = wrapDataKey(dataKey);
  dataKey.fill(0); // best-effort scrub; V8 may still retain copies via GC, not a hard guarantee

  return {
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    authTag: sealed.authTag,
    wrappedDataKey: wrapped.wrapped,
    wrapIv: wrapped.wrapIv,
    wrapAuthTag: wrapped.wrapAuthTag,
  };
}

/** Reverses `encryptPrivateKey`. Callers must treat the return value as sensitive and short-lived. */
export function decryptPrivateKey(enc: EncryptedKey): string {
  const dataKey = unwrapDataKey(enc.wrappedDataKey, enc.wrapIv, enc.wrapAuthTag);
  const plaintext = unseal(
    { ciphertext: enc.ciphertext, iv: enc.iv, authTag: enc.authTag },
    dataKey,
  );
  dataKey.fill(0);
  return plaintext.toString("utf8");
}
