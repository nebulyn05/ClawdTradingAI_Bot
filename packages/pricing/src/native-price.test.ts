import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomBytes } from "node:crypto";

// pyth.ts's createLogger call runs loadConfig() at import time — see
// CLAUDE.md's note on this repo's test convention.
beforeAll(() => {
  process.env.MASTER_ENCRYPTION_KEY ??= randomBytes(32).toString("hex");
  process.env.DATABASE_URL ??= "postgresql://clawd:clawd@localhost:5432/clawd_agents";
  process.env.REDIS_URL ??= "redis://localhost:6379";
});

describe("nativeAssetPythSymbol", () => {
  it("maps solana to SOL/USD", async () => {
    const { nativeAssetPythSymbol } = await import("./native-price.js");
    expect(nativeAssetPythSymbol("solana")).toBe("SOL/USD");
  });

  it("maps ethereum and base to ETH/USD (both are ETH-denominated)", async () => {
    const { nativeAssetPythSymbol } = await import("./native-price.js");
    expect(nativeAssetPythSymbol("ethereum")).toBe("ETH/USD");
    expect(nativeAssetPythSymbol("base")).toBe("ETH/USD");
  });

  it("maps bsc to BNB/USD", async () => {
    const { nativeAssetPythSymbol } = await import("./native-price.js");
    expect(nativeAssetPythSymbol("bsc")).toBe("BNB/USD");
  });

  it("returns null for monad and robinhood — no verified feed, not a guess", async () => {
    const { nativeAssetPythSymbol } = await import("./native-price.js");
    expect(nativeAssetPythSymbol("monad")).toBeNull();
    expect(nativeAssetPythSymbol("robinhood")).toBeNull();
  });
});

describe("getNativeAssetUsdPrice", () => {
  it("short-circuits to null for chains with no symbol mapping, without a network call", async () => {
    const { getNativeAssetUsdPrice } = await import("./native-price.js");
    await expect(getNativeAssetUsdPrice("monad")).resolves.toBeNull();
    await expect(getNativeAssetUsdPrice("robinhood")).resolves.toBeNull();
  });

  it("returns the Pyth price without falling back when Pyth succeeds", async () => {
    vi.doMock("./pyth.js", () => ({ getPythPrice: vi.fn().mockResolvedValue(2500) }));
    const chainlinkMock = vi.fn().mockResolvedValue(2400);
    vi.doMock("./chainlink.js", () => ({ getChainlinkPrice: chainlinkMock }));
    vi.resetModules();

    const { getNativeAssetUsdPrice } = await import("./native-price.js");
    await expect(getNativeAssetUsdPrice("ethereum")).resolves.toBe(2500);
    expect(chainlinkMock).not.toHaveBeenCalled();
    vi.doUnmock("./pyth.js");
    vi.doUnmock("./chainlink.js");
    vi.resetModules();
  });

  it("falls back to Chainlink for ethereum/base/bsc when Pyth is unavailable", async () => {
    vi.doMock("./pyth.js", () => ({ getPythPrice: vi.fn().mockResolvedValue(null) }));
    const chainlinkMock = vi.fn().mockResolvedValue(2450);
    vi.doMock("./chainlink.js", () => ({ getChainlinkPrice: chainlinkMock }));
    vi.resetModules();

    const { getNativeAssetUsdPrice } = await import("./native-price.js");
    await expect(getNativeAssetUsdPrice("ethereum")).resolves.toBe(2450);
    expect(chainlinkMock).toHaveBeenCalledWith("ethereum", "ETH/USD");

    await expect(getNativeAssetUsdPrice("base")).resolves.toBe(2450);
    expect(chainlinkMock).toHaveBeenCalledWith("base", "ETH/USD");

    await expect(getNativeAssetUsdPrice("bsc")).resolves.toBe(2450);
    expect(chainlinkMock).toHaveBeenCalledWith("bsc", "BNB/USD");

    vi.doUnmock("./pyth.js");
    vi.doUnmock("./chainlink.js");
    vi.resetModules();
  });

  it("has no Chainlink fallback for solana — returns null if Pyth fails", async () => {
    vi.doMock("./pyth.js", () => ({ getPythPrice: vi.fn().mockResolvedValue(null) }));
    const chainlinkMock = vi.fn().mockResolvedValue(999);
    vi.doMock("./chainlink.js", () => ({ getChainlinkPrice: chainlinkMock }));
    vi.resetModules();

    const { getNativeAssetUsdPrice } = await import("./native-price.js");
    await expect(getNativeAssetUsdPrice("solana")).resolves.toBeNull();
    expect(chainlinkMock).not.toHaveBeenCalled();

    vi.doUnmock("./pyth.js");
    vi.doUnmock("./chainlink.js");
    vi.resetModules();
  });
});
