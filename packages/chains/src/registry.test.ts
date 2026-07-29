import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

beforeAll(() => {
  process.env.MASTER_ENCRYPTION_KEY ??= randomBytes(32).toString("hex");
  process.env.DATABASE_URL ??= "postgresql://clawd:clawd@localhost:5432/clawd_agents";
  process.env.REDIS_URL ??= "redis://localhost:6379";
});

describe("chain adapter registry", () => {
  it("returns an enabled adapter for all 6 chains — no stubs", async () => {
    const { getChainAdapter } = await import("./registry.js");
    for (const chain of ["solana", "ethereum", "bsc", "base", "monad", "robinhood"] as const) {
      const adapter = getChainAdapter(chain);
      expect(adapter.chain).toBe(chain);
      expect(adapter.enabled).toBe(true);
      expect(adapter.network).toBe("testnet");
    }
  });

  it("caches adapters across calls", async () => {
    const { getChainAdapter } = await import("./registry.js");
    expect(getChainAdapter("solana")).toBe(getChainAdapter("solana"));
  });
});
