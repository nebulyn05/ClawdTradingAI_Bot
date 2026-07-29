import type { EncryptedKey } from "@clawd/core";

/** Shape common to a Prisma Wallet row's encrypted-key columns. */
export interface EncryptedKeyColumns {
  encCiphertext: string;
  encAuthTag: string;
  encIv: string;
  encWrappedDataKey: string;
  encWrapIv: string;
  encWrapAuthTag: string;
}

export function toEncryptedKey(wallet: EncryptedKeyColumns): EncryptedKey {
  return {
    ciphertext: wallet.encCiphertext,
    authTag: wallet.encAuthTag,
    iv: wallet.encIv,
    wrappedDataKey: wallet.encWrappedDataKey,
    wrapIv: wallet.encWrapIv,
    wrapAuthTag: wallet.encWrapAuthTag,
  };
}
