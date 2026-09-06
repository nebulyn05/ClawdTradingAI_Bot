import { describe, it, expect } from "vitest";
import { checkPortfolioExposure, maxAdditionalExposureRaw } from "./exposure.js";

describe("checkPortfolioExposure", () => {
  it("approves a proposed position with no existing exposure, under the cap", () => {
    // Portfolio: 0 held + 100 balance = 100 total. Proposing 40 (40%), cap 50%.
    const result = checkPortfolioExposure([], 40n, 100n, 0.5);
    expect(result.approved).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("rejects when the proposed position alone would exceed the cap", () => {
    // Portfolio: 0 held + 100 balance = 100 total. Proposing 60 (60%), cap 50%.
    const result = checkPortfolioExposure([], 60n, 100n, 0.5);
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/60\.0%/);
    expect(result.reason).toMatch(/50% cap/);
  });

  it("sums multiple open positions before applying the cap", () => {
    // Held: 30 + 20 = 50. Balance 50. Total 100. Proposing 10 -> 60% > 50% cap.
    const result = checkPortfolioExposure([30n, 20n], 10n, 50n, 0.5);
    expect(result.approved).toBe(false);
  });

  it("approves exactly at the cap boundary", () => {
    // Held 40, balance 60, total 100. Proposing 10 -> exactly 50%, cap 50%.
    const result = checkPortfolioExposure([40n], 10n, 60n, 0.5);
    expect(result.approved).toBe(true);
  });

  it("rejects by a single unit just above the cap boundary", () => {
    const result = checkPortfolioExposure([40n], 11n, 60n, 0.5);
    expect(result.approved).toBe(false);
  });

  it("rejects when total portfolio value is zero", () => {
    const result = checkPortfolioExposure([], 0n, 0n, 0.5);
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/zero/);
  });

  it("handles wei-scale bigints without precision loss", () => {
    const heldWei = 4_000_000_000_000_000_000n; // 4 ETH
    const balanceWei = 6_000_000_000_000_000_000n; // 6 ETH
    const proposedWei = 2_000_000_000_000_000_000n; // 2 ETH -> 60% of 10 ETH total
    const result = checkPortfolioExposure([heldWei], proposedWei, balanceWei, 0.5);
    expect(result.approved).toBe(false);
  });
});

describe("maxAdditionalExposureRaw", () => {
  it("returns the full cap when there's no existing exposure", () => {
    // Total 100, cap 50% -> 50 of room, nothing held yet.
    expect(maxAdditionalExposureRaw([], 100n, 0.5)).toBe(50n);
  });

  it("returns the remaining room after existing positions", () => {
    // Held 30, balance 70, total 100, cap 50% -> max exposure 50, remaining 20.
    expect(maxAdditionalExposureRaw([30n], 70n, 0.5)).toBe(20n);
  });

  it("returns zero once already at or past the cap", () => {
    // Held 60, balance 40, total 100, cap 50% -> max exposure 50, already over.
    expect(maxAdditionalExposureRaw([60n], 40n, 0.5)).toBe(0n);
  });

  it("returns zero for a zero-value portfolio", () => {
    expect(maxAdditionalExposureRaw([], 0n, 0.5)).toBe(0n);
  });

  it("agrees with checkPortfolioExposure at the boundary it computes", () => {
    const room = maxAdditionalExposureRaw([40n], 60n, 0.5);
    expect(checkPortfolioExposure([40n], room, 60n, 0.5).approved).toBe(true);
    expect(checkPortfolioExposure([40n], room + 1n, 60n, 0.5).approved).toBe(false);
  });
});
