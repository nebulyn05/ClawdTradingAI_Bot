import { describe, it, expect } from "vitest";
import { findSpreadCandidates } from "./spread.js";

describe("findSpreadCandidates", () => {
  it("finds no opportunity when prices are within the bridge-cost + margin threshold", () => {
    const candidates = findSpreadCandidates({ solana: 1.0, ethereum: 1.005 }, 0.005, 0.01);
    expect(candidates).toHaveLength(0);
  });

  it("finds a directed opportunity when the spread clears the threshold", () => {
    const candidates = findSpreadCandidates({ solana: 1.0, ethereum: 1.02 }, 0.005, 0.01);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ buyChain: "solana", sellChain: "ethereum" });
    expect(candidates[0]!.spreadPct).toBeCloseTo(0.02, 5);
  });

  it("only reports the profitable direction, not both ways", () => {
    const candidates = findSpreadCandidates({ solana: 1.0, ethereum: 1.05 }, 0.005, 0.01);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.buyChain).toBe("solana");
    expect(candidates[0]!.sellChain).toBe("ethereum");
  });

  it("handles three chains and reports every clearing pair", () => {
    const candidates = findSpreadCandidates({ solana: 1.0, ethereum: 1.05, bsc: 0.9 }, 0.005, 0.01);
    // solana->ethereum, bsc->solana, bsc->ethereum all clear; nothing selling into bsc does.
    expect(candidates.length).toBe(3);
    expect(candidates.some((c) => c.buyChain === "bsc" && c.sellChain === "ethereum")).toBe(true);
  });

  it("ignores non-positive prices", () => {
    const candidates = findSpreadCandidates({ solana: 0, ethereum: 1.05 }, 0.005, 0.01);
    expect(candidates).toHaveLength(0);
  });
});
