import { describe, it, expect } from "vitest";
import {
  buildEquityCurve,
  computeWinRate,
  computeAvgWinPct,
  computeAvgLossPct,
  computeMaxDrawdownPct,
  computeTotalReturnPct,
} from "./metrics.js";

describe("buildEquityCurve", () => {
  it("compounds returns sequentially from a starting equity of 1", () => {
    const curve = buildEquityCurve([0.5, -0.2]);
    expect(curve).toHaveLength(3);
    expect(curve[0]).toBe(1);
    expect(curve[1]).toBeCloseTo(1.5);
    expect(curve[2]).toBeCloseTo(1.2);
  });

  it("returns just the starting equity for an empty return list", () => {
    expect(buildEquityCurve([])).toEqual([1]);
  });
});

describe("computeWinRate", () => {
  it("computes the fraction of positive returns", () => {
    expect(computeWinRate([0.1, -0.1, 0.2, -0.3, 0.05])).toBeCloseTo(0.6);
  });

  it("returns 0 for an empty list", () => {
    expect(computeWinRate([])).toBe(0);
  });
});

describe("computeAvgWinPct / computeAvgLossPct", () => {
  it("averages wins and losses separately", () => {
    const returns = [0.5, 0.3, -0.2, -0.4];
    expect(computeAvgWinPct(returns)).toBeCloseTo(0.4);
    expect(computeAvgLossPct(returns)).toBeCloseTo(-0.3);
  });

  it("returns 0 when there are no wins or no losses", () => {
    expect(computeAvgWinPct([-0.1, -0.2])).toBe(0);
    expect(computeAvgLossPct([0.1, 0.2])).toBe(0);
  });
});

describe("computeMaxDrawdownPct", () => {
  it("finds the largest peak-to-trough decline", () => {
    // 1 -> 2 (peak) -> 1 (50% drawdown) -> 1.6
    expect(computeMaxDrawdownPct([1, 2, 1, 1.6])).toBeCloseTo(0.5);
  });

  it("is zero for a monotonically increasing curve", () => {
    expect(computeMaxDrawdownPct([1, 1.1, 1.3, 1.5])).toBe(0);
  });
});

describe("computeTotalReturnPct", () => {
  it("computes overall return from first to last point", () => {
    expect(computeTotalReturnPct([1, 1.5, 1.2])).toBeCloseTo(0.2);
  });

  it("returns 0 for a degenerate (single-point or zero-start) curve", () => {
    expect(computeTotalReturnPct([1])).toBe(0);
    expect(computeTotalReturnPct([0, 5])).toBe(0);
  });
});
