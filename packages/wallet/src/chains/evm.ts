import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { KeyMaterial } from "./types.js";

/** Generates a new EVM (Ethereum/BSC/Base) account. `rawKey` is a 0x-prefixed hex private key. */
export function generateEvmKey(): KeyMaterial {
  const rawKey = generatePrivateKey();
  const account = privateKeyToAccount(rawKey);
  return { address: account.address, rawKey };
}

/** Imports a 0x-prefixed hex private key, validating it derives a real account. */
export function importEvmKey(rawKey: string): KeyMaterial {
  const trimmed = rawKey.trim();
  const normalized = (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("Invalid EVM private key: expected a 32-byte hex string");
  }
  const account = privateKeyToAccount(normalized);
  return { address: account.address, rawKey: normalized };
}
