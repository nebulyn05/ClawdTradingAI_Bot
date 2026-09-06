import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { privateKeyToAccount } from "viem/accounts";
import { toHex } from "viem";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { HDKey as Ed25519HDKey } from "micro-key-producer/slip10.js";
import type { KeyMaterial } from "./types.js";

// Standard MetaMask-compatible EVM path and the Solana ecosystem's standard
// path (used by Phantom/Solflare for the primary account) — same defaults a
// user's existing wallet app would have used, so importing the same phrase
// here reproduces the same addresses they already know.
const EVM_DERIVATION_PATH = "m/44'/60'/0'/0/0";
const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";

export function isValidMnemonic(phrase: string): boolean {
  try {
    return validateMnemonic(phrase.trim().toLowerCase(), wordlist);
  } catch {
    return false;
  }
}

export function deriveEvmFromMnemonic(mnemonic: string): KeyMaterial {
  const seed = mnemonicToSeedSync(mnemonic.trim().toLowerCase());
  const hdKey = HDKey.fromMasterSeed(seed).derive(EVM_DERIVATION_PATH);
  if (!hdKey.privateKey) throw new Error("Failed to derive an EVM key from this mnemonic.");
  const rawKey = toHex(hdKey.privateKey);
  const account = privateKeyToAccount(rawKey);
  return { address: account.address, rawKey };
}

export function deriveSolanaFromMnemonic(mnemonic: string): KeyMaterial {
  const seed = mnemonicToSeedSync(mnemonic.trim().toLowerCase());
  const hdKey = Ed25519HDKey.fromMasterSeed(seed).derive(SOLANA_DERIVATION_PATH);
  const keypair = Keypair.fromSeed(hdKey.privateKey);
  return { address: keypair.publicKey.toBase58(), rawKey: bs58.encode(keypair.secretKey) };
}
