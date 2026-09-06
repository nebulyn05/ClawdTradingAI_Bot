import { describe, it, expect } from "vitest";
import { formatTokenAmount, parseTokenAmount } from "./token-amount.js";

describe("formatTokenAmount", () => {
  it("formats whole and fractional amounts for arbitrary decimals", () => {
    expect(formatTokenAmount(1_000_000n, 6)).toBe("1"); // USDC-style 6 decimals
    expect(formatTokenAmount(1_500_000n, 6)).toBe("1.5");
    expect(formatTokenAmount(1_000_000_000_000_000_000n, 18)).toBe("1"); // ERC20 18 decimals
  });

  it("formats zero", () => {
    expect(formatTokenAmount(0n, 6)).toBe("0");
  });
});

describe("parseTokenAmount", () => {
  it("round-trips whole and fractional amounts through format/parse at 6 and 18 decimals", () => {
    expect(parseTokenAmount("1", 6)).toBe(1_000_000n);
    expect(parseTokenAmount("1.5", 6)).toBe(1_500_000n);
    expect(parseTokenAmount("0.000001", 6)).toBe(1n);
    expect(parseTokenAmount("2.5", 18)).toBe(2_500_000_000_000_000_000n);
  });

  it("rejects non-numeric input", () => {
    expect(() => parseTokenAmount("abc", 6)).toThrow();
    expect(() => parseTokenAmount("1.2.3", 6)).toThrow();
    expect(() => parseTokenAmount("-1", 6)).toThrow();
  });
});
