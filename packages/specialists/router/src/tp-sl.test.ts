import { describe, it, expect } from "vitest";
import {
  computeTakeProfitPrice,
  computeStopLossPrice,
  checkExitTrigger,
  computeFee,
  computeFeeRaw,
} from "./tp-sl.js";

describe("computeTakeProfitPrice / computeStopLossPrice", () => {
  it("computes +50% take-profit and -20% stop-loss from entry", () => {
    expect(computeTakeProfitPrice(100, 0.5)).toBe(150);
    expect(computeStopLossPrice(100, 0.2)).toBe(80);
  });
});

describe("checkExitTrigger", () => {
  const tp = 150;
  const sl = 80;

  it("returns null while price is between stop-loss and take-profit", () => {
    expect(checkExitTrigger(120, tp, sl)).toBeNull();
  });

  it("triggers take_profit at or above the target", () => {
    expect(checkExitTrigger(150, tp, sl)).toBe("take_profit");
    expect(checkExitTrigger(200, tp, sl)).toBe("take_profit");
  });

  it("triggers stop_loss at or below the target", () => {
    expect(checkExitTrigger(80, tp, sl)).toBe("stop_loss");
    expect(checkExitTrigger(50, tp, sl)).toBe("stop_loss");
  });
});

describe("computeFee", () => {
  it("charges the fee rate on profitable trades", () => {
    expect(computeFee(100, 0.02)).toBe(2);
  });

  it("charges nothing on a loss or breakeven trade", () => {
    expect(computeFee(-50, 0.02)).toBe(0);
    expect(computeFee(0, 0.02)).toBe(0);
  });
});

describe("computeFeeRaw", () => {
  it("takes 2% of a large (wei-scale) profit exactly", () => {
    const profit = 1_000_000_000_000_000_000n; // 1 ETH of profit
    expect(computeFeeRaw(profit, 0.02)).toBe(20_000_000_000_000_000n); // 0.02 ETH
  });

  it("charges nothing on a loss", () => {
    expect(computeFeeRaw(-1_000_000_000_000_000_000n, 0.02)).toBe(0n);
  });

  it("charges nothing on exactly breakeven", () => {
    expect(computeFeeRaw(0n, 0.02)).toBe(0n);
  });
});
