import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

beforeAll(() => {
  process.env.MASTER_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.DATABASE_URL ??= "postgresql://clawd:clawd@localhost:5432/clawd_agents";
  process.env.REDIS_URL ??= "redis://localhost:6379";
});

describe("signer", () => {
  it("creates a Solana wallet with a valid address", async () => {
    const { createWallet, exportRawKey } = await import("./signer.js");
    const wallet = createWallet("solana");
    expect(wallet.address.length).toBeGreaterThan(30);
    const raw = exportRawKey(wallet.encryptedKey);
    expect(typeof raw).toBe("string");
    expect(raw.length).toBeGreaterThan(0);
  });

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
