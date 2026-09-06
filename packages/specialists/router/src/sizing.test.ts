import { describe, it, expect } from "vitest";
import { computeCategoryStats, computePositionSize, type CategoryStats } from "./sizing.js";

describe("computeCategoryStats", () => {
  it("returns null when there are fewer trades than the minimum sample size", () => {
    const trades = [
      { profitable: true, profitAmount: "100" },
      { profitable: false, profitAmount: "-50" },
    ];
    expect(computeCategoryStats(trades, 5)).toBeNull();
  });

  it("returns null when every closed trade was a win (no loss magnitude to compare against)", () => {
    const trades = Array.from({ length: 6 }, () => ({ profitable: true, profitAmount: "100" }));
    expect(computeCategoryStats(trades, 5)).toBeNull();
  });

  it("returns null when every closed trade was a loss", () => {
    const trades = Array.from({ length: 6 }, () => ({ profitable: false, profitAmount: "-100" }));
    expect(computeCategoryStats(trades, 5)).toBeNull();
  });

  it("computes win rate and win/loss ratio for a mixed sample", () => {
    const trades = [
      { profitable: true, profitAmount: "200" },
      { profitable: true, profitAmount: "200" },
      { profitable: true, profitAmount: "200" },
      { profitable: false, profitAmount: "-100" },
      { profitable: false, profitAmount: "-100" },
    ];
    const stats = computeCategoryStats(trades, 5);
    expect(stats).not.toBeNull();
    expect(stats!.winRate).toBeCloseTo(0.6);
    expect(stats!.avgWinLossRatio).toBeCloseTo(2.0);
  });

  it("stays exact at wei scale (no Number(bigint) precision loss)", () => {
    const bigWin = "3000000000000000000"; // 3 ETH
    const bigLoss = "-1000000000000000000"; // 1 ETH
    const trades = [
      { profitable: true, profitAmount: bigWin },
      { profitable: true, profitAmount: bigWin },
      { profitable: false, profitAmount: bigLoss },
      { profitable: false, profitAmount: bigLoss },
      { profitable: false, profitAmount: bigLoss },
    ];
    const stats = computeCategoryStats(trades, 5);
    expect(stats!.avgWinLossRatio).toBeCloseTo(3.0);
  });
});

describe("computePositionSize", () => {
  const balance = 1_000n;

  it("falls back to the flat default size when there's no historical data", () => {
    const result = computePositionSize({
      stats: null,
      availableBalanceRaw: balance,
      fallbackSizeRaw: 50n,
      kellyFraction: 0.25,
      maxPositionPct: 0.5,
      maxAdditionalExposureRaw: 1_000n,
    });
    expect(result.sizeRaw).toBe(50n);
    expect(result.reason).toMatch(/flat conservative default/);
  });

  it("caps the fallback size at the max-per-trade cap", () => {
    const result = computePositionSize({
      stats: null,
      availableBalanceRaw: balance,
      fallbackSizeRaw: 900n,
      kellyFraction: 0.25,
      maxPositionPct: 0.1, // 10% of 1000 = 100
      maxAdditionalExposureRaw: 1_000n,
    });
    expect(result.sizeRaw).toBe(100n);
  });

  it("rejects (returns zero) on negative expectancy", () => {
    const badEdge: CategoryStats = { winRate: 0.3, avgWinLossRatio: 1 }; // f* = 0.3 - 0.7/1 < 0
    const result = computePositionSize({
      stats: badEdge,
      availableBalanceRaw: balance,
      fallbackSizeRaw: 50n,
      kellyFraction: 0.25,
      maxPositionPct: 0.5,
      maxAdditionalExposureRaw: 1_000n,
    });
    expect(result.sizeRaw).toBe(0n);
    expect(result.reason).toMatch(/Negative expectancy/);
  });

  it("sizes a positive-expectancy category at a fraction of full Kelly", () => {
    // p=0.6, b=2 -> f* = 0.6 - 0.4/2 = 0.4. Quarter-Kelly -> 0.1 of balance = 100.
    const goodEdge: CategoryStats = { winRate: 0.6, avgWinLossRatio: 2 };
    const result = computePositionSize({
      stats: goodEdge,
      availableBalanceRaw: balance,
      fallbackSizeRaw: 50n,
      kellyFraction: 0.25,
      maxPositionPct: 0.5,
      maxAdditionalExposureRaw: 1_000n,
    });
    expect(result.sizeRaw).toBe(100n);
  });

  it("caps a large Kelly size at the max-per-trade cap", () => {
    const strongEdge: CategoryStats = { winRate: 0.9, avgWinLossRatio: 5 }; // f* very high
    const result = computePositionSize({
      stats: strongEdge,
      availableBalanceRaw: balance,
      fallbackSizeRaw: 50n,
      kellyFraction: 1, // full Kelly to force hitting the cap
      maxPositionPct: 0.2, // 20% of 1000 = 200
      maxAdditionalExposureRaw: 1_000n,
    });
    expect(result.sizeRaw).toBe(200n);
  });

  it("caps sizing at the portfolio exposure ceiling when it's the tighter constraint", () => {
    const goodEdge: CategoryStats = { winRate: 0.6, avgWinLossRatio: 2 }; // f* = 0.4, quarter-Kelly = 100
    const result = computePositionSize({
      stats: goodEdge,
      availableBalanceRaw: balance,
      fallbackSizeRaw: 50n,
      kellyFraction: 0.25,
      maxPositionPct: 0.5, // would allow 500
      maxAdditionalExposureRaw: 30n, // exposure cap only has room for 30
    });
    expect(result.sizeRaw).toBe(30n);
  });

  it("returns zero when there's no available balance", () => {
    const result = computePositionSize({
      stats: null,
      availableBalanceRaw: 0n,
      fallbackSizeRaw: 50n,
      kellyFraction: 0.25,
      maxPositionPct: 0.5,
      maxAdditionalExposureRaw: 1_000n,
    });
    expect(result.sizeRaw).toBe(0n);
  });

  it("returns zero when the exposure cap leaves no room", () => {
    const result = computePositionSize({
      stats: null,
      availableBalanceRaw: balance,
      fallbackSizeRaw: 50n,
      kellyFraction: 0.25,
      maxPositionPct: 0.5,
      maxAdditionalExposureRaw: 0n,
    });
    expect(result.sizeRaw).toBe(0n);
    expect(result.reason).toMatch(/No room left/);
  });
});
