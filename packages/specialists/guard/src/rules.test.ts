import { describe, it, expect } from "vitest";
import { computeSolanaScore, computeEvmScore, PASS_THRESHOLD } from "./rules.js";

describe("computeSolanaScore", () => {
  it("passes a clean token with good liquidity and renounced authorities", () => {
    const result = computeSolanaScore(50_000, {
      mintable: { status: "0" },
      freezable: { status: "0" },
      top10_holder_rate: "0.2",
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
    expect(result.reasons).toHaveLength(0);
  });

  it("fails a token with an active mint authority", () => {
    const result = computeSolanaScore(50_000, {
      mintable: { status: "1" },
      freezable: { status: "0" },
      top10_holder_rate: "0.2",
    });
    expect(result.checks.mintAuthorityRenounced).toBe(false);
    expect(result.score).toBe(70);
    expect(result.passed).toBe(true); // 70 >= 60 threshold, still a warning not a hard fail
  });

  it("fails a token with low liquidity and concentrated holders", () => {
    const result = computeSolanaScore(100, {
      mintable: { status: "0" },
      freezable: { status: "0" },
      top10_holder_rate: "0.9",
    });
    expect(result.score).toBeLessThan(PASS_THRESHOLD);
    expect(result.passed).toBe(false);
  });

  it("degrades gracefully with no security data (e.g. testnet)", () => {
    const result = computeSolanaScore(50_000, null);
    expect(result.reasons.some((r) => r.includes("unavailable"))).toBe(true);
    expect(result.passed).toBe(true);
  });
});

describe("computeEvmScore", () => {
  it("hard-fails a honeypot regardless of everything else", () => {
    const result = computeEvmScore(1_000_000, {
      is_honeypot: "1",
      owner_address: "0x0000000000000000000000000000000000000000",
      sell_tax: "0",
    });
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });

  it("passes a clean renounced token with reasonable tax", () => {
    const result = computeEvmScore(10_000, {
      is_honeypot: "0",
      owner_address: "0x0000000000000000000000000000000000000000",
      sell_tax: "0.05",
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  });

  it("penalizes unrenounced ownership and high sell tax without hard-failing", () => {
    const result = computeEvmScore(10_000, {
      is_honeypot: "0",
      owner_address: "0x1234567890123456789012345678901234567890",
      sell_tax: "0.3",
    });
    expect(result.checks.ownershipRenounced).toBe(false);
    expect(result.checks.reasonableSellTax).toBe(false);
    expect(result.score).toBe(60);
  });
});
