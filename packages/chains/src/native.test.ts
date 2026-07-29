import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

beforeAll(() => {
  process.env.MASTER_ENCRYPTION_KEY ??= randomBytes(32).toString("hex");
  process.env.DATABASE_URL ??= "postgresql://clawd:clawd@localhost:5432/clawd_agents";
  process.env.REDIS_URL ??= "redis://localhost:6379";
});

describe("formatNativeAmount", () => {
  it("formats whole lamports/wei amounts", async () => {
    const { formatNativeAmount } = await import("./index.js");
    expect(formatNativeAmount("solana", 2_000_000_000n)).toBe("2");
    expect(formatNativeAmount("ethereum", 1_000_000_000_000_000_000n)).toBe("1");
  });

  it("formats fractional amounts, trimming trailing zeros", async () => {
    const { formatNativeAmount } = await import("./index.js");
    expect(formatNativeAmount("solana", 1_500_000_000n)).toBe("1.5");
    expect(formatNativeAmount("solana", 1_050_000_000n)).toBe("1.05");
  });

  it("formats zero", async () => {
    const { formatNativeAmount } = await import("./index.js");
    expect(formatNativeAmount("solana", 0n)).toBe("0");
  });
});

describe("parseNativeAmount", () => {
  it("round-trips whole and fractional amounts through format/parse", async () => {
    const { parseNativeAmount } = await import("./index.js");
    expect(parseNativeAmount("solana", "2")).toBe(2_000_000_000n);
    expect(parseNativeAmount("solana", "1.5")).toBe(1_500_000_000n);
    expect(parseNativeAmount("ethereum", "0.001")).toBe(1_000_000_000_000_000n);
  });

  it("rejects non-numeric input", async () => {
    const { parseNativeAmount } = await import("./index.js");
    expect(() => parseNativeAmount("solana", "abc")).toThrow();
    expect(() => parseNativeAmount("solana", "1.2.3")).toThrow();
    expect(() => parseNativeAmount("solana", "-1")).toThrow();
  });
});

describe("nativeQuoteAddress", () => {
  it("returns the WSOL mint for solana and the sentinel for every EVM-family chain", async () => {
    const { nativeQuoteAddress, NATIVE_TOKEN_ADDRESS } = await import("./index.js");
    expect(nativeQuoteAddress("solana")).toBe("So11111111111111111111111111111111111111112");
    for (const chain of ["ethereum", "bsc", "base", "monad", "robinhood"] as const) {
      expect(nativeQuoteAddress(chain)).toBe(NATIVE_TOKEN_ADDRESS);
    }
  });
});
