import { describe, it, expect } from "vitest";
import { computeDrawdown, shouldPauseTrading } from "./circuit-breaker.js";

describe("computeDrawdown", () => {
  it("finds the worst peak-to-trough decline in a mixed win/loss sequence", () => {
    // Cumulative: 100 -> 200 (peak) -> 50 -> 150. Worst drawdown: 200 -> 50 = 75%.
    const result = computeDrawdown([100n, 100n, -150n, 100n]);
    expect(result.peakRaw).toBe(200n);
    expect(result.troughRaw).toBe(50n);
    expect(result.drawdownPct).toBeCloseTo(0.75);
  });

  it("returns zero drawdown for an all-winning sequence", () => {
    const result = computeDrawdown([100n, 50n, 200n]);
    expect(result.drawdownPct).toBe(0);
  });

  it("returns zero drawdown for an empty sequence", () => {
    const result = computeDrawdown([]);
    expect(result.drawdownPct).toBe(0);
  });

  it("treats a pure-loss window (peak never turns positive) as maximal drawdown", () => {
    const result = computeDrawdown([-50n, -30n, -20n]);
    expect(result.peakRaw).toBe(0n);
    expect(result.drawdownPct).toBe(1);
  });

  it("can exceed 100% when losses eat past a prior positive peak", () => {
    // Cumulative: 100 (peak) -> -500. Drawdown = 600 / 100 = 600%.
    const result = computeDrawdown([100n, -600n]);
    expect(result.drawdownPct).toBeCloseTo(6.0);
  });

  it("handles wei-scale bigints exactly", () => {
    const win = 3_000_000_000_000_000_000n; // 3 ETH
    const loss = -2_000_000_000_000_000_000n; // 2 ETH
    const result = computeDrawdown([win, loss]);
    expect(result.drawdownPct).toBeCloseTo(2 / 3);
  });
});

describe("shouldPauseTrading", () => {
  it("pauses when drawdown exceeds the threshold", () => {
    expect(shouldPauseTrading(0.35, 0.3)).toBe(true);
  });

  it("does not pause at or below the threshold", () => {
    expect(shouldPauseTrading(0.3, 0.3)).toBe(false);
    expect(shouldPauseTrading(0.1, 0.3)).toBe(false);
  });
});
