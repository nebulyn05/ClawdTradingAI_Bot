import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

beforeAll(() => {
  process.env.MASTER_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.DATABASE_URL ??= "postgresql://clawd:clawd@localhost:5432/clawd_agents";
  process.env.REDIS_URL ??= "redis://localhost:6379";
});

describe("signer", () => {
  // Solana keypair generation + scrypt-based envelope encryption is CPU-bound
  // enough that it can exceed vitest's default 5s under full-suite worker
  // contention (observed flaking repeatedly in CI-like conditions) despite
  // running in well under 2s in isolation — a longer timeout, not a retry or
  // a skip, is the correct fix since the test itself isn't flaky, the shared
  // CPU budget is.
  it("creates a Solana wallet with a valid address", async () => {
    const { createWallet, exportRawKey } = await import("./signer.js");
    const wallet = createWallet("solana");
    expect(wallet.address.length).toBeGreaterThan(30);
    const raw = exportRawKey(wallet.encryptedKey);
    expect(typeof raw).toBe("string");
    expect(raw.length).toBeGreaterThan(0);
  }, 15000);

  it("creates an EVM wallet with a 0x-prefixed address", async () => {
    const { createWallet } = await import("./signer.js");
    const wallet = createWallet("ethereum");
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("creates Monad and Robinhood Chain wallets (EVM-family, same as ethereum/bsc/base)", async () => {
    const { createWallet } = await import("./signer.js");
    expect(createWallet("monad").address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(createWallet("robinhood").address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("round-trips create -> withDecryptedKey", async () => {
    const { createWallet, withDecryptedKey } = await import("./signer.js");
    const wallet = createWallet("solana");
    const seen = await withDecryptedKey(wallet.encryptedKey, async (rawKey) => rawKey);
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe("detectImportMaterial", () => {
  it("detects an EVM hex private key", async () => {
    const { generateKeyMaterial, detectImportMaterial } = await import("./signer.js");
    const generated = generateKeyMaterial("ethereum");
    const detected = detectImportMaterial(generated.rawKey);
    expect(detected.kind).toBe("evm");
    if (detected.kind === "evm") expect(detected.material.address).toBe(generated.address);
  });

  it("detects an EVM hex private key without the 0x prefix", async () => {
    const { generateKeyMaterial, detectImportMaterial } = await import("./signer.js");
    const generated = generateKeyMaterial("ethereum");
    const detected = detectImportMaterial(generated.rawKey.slice(2));
    expect(detected.kind).toBe("evm");
    if (detected.kind === "evm") expect(detected.material.address).toBe(generated.address);
  });

  it("detects a Solana base58 secret key (Phantom format)", async () => {
    const { generateKeyMaterial, detectImportMaterial } = await import("./signer.js");
    const generated = generateKeyMaterial("solana");
    const detected = detectImportMaterial(generated.rawKey);
    expect(detected.kind).toBe("solana");
    if (detected.kind === "solana") expect(detected.material.address).toBe(generated.address);
  });

  it("detects a Solana JSON byte-array secret key (Solflare/Backpack format)", async () => {
    const bs58 = (await import("bs58")).default;
    const { generateKeyMaterial, detectImportMaterial } = await import("./signer.js");
    const generated = generateKeyMaterial("solana");
    const bytes = Array.from(bs58.decode(generated.rawKey));
    const detected = detectImportMaterial(JSON.stringify(bytes));
    expect(detected.kind).toBe("solana");
    if (detected.kind === "solana") expect(detected.material.address).toBe(generated.address);
  });

  it("detects a 12-word BIP39 mnemonic and derives both an EVM and a Solana identity", async () => {
    const { generateMnemonic } = await import("@scure/bip39");
    const { wordlist } = await import("@scure/bip39/wordlists/english");
    const { detectImportMaterial } = await import("./signer.js");
    const mnemonic = generateMnemonic(wordlist);
    const detected = detectImportMaterial(mnemonic);
    expect(detected.kind).toBe("mnemonic");
    if (detected.kind === "mnemonic") {
      expect(detected.evm.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(detected.solana.address.length).toBeGreaterThan(30);
    }
  });

  it("detects mnemonics at every valid BIP39 length (15, 18, 21, 24 words)", async () => {
    const { generateMnemonic } = await import("@scure/bip39");
    const { wordlist } = await import("@scure/bip39/wordlists/english");
    const { detectImportMaterial } = await import("./signer.js");
    for (const [strength, wordCount] of [
      [160, 15],
      [192, 18],
      [224, 21],
      [256, 24],
    ] as const) {
      const mnemonic = generateMnemonic(wordlist, strength);
      expect(mnemonic.split(" ").length).toBe(wordCount);
      const detected = detectImportMaterial(mnemonic);
      expect(detected.kind).toBe("mnemonic");
    }
  });

  it("rejects an unrecognized format", async () => {
    const { detectImportMaterial } = await import("./signer.js");
    expect(() => detectImportMaterial("not a valid key or phrase")).toThrow(/Unrecognized format/);
  });
});
