import { describe, it, expect } from "vitest";
import { guardWouldPass } from "./rule-filter.js";

describe("guardWouldPass", () => {
  it("fails closed when there's no stored Guard score for the token", () => {
    expect(guardWouldPass(null, null, { passThreshold: 60 })).toBe(false);
  });

  it("rejects a score below the candidate threshold", () => {
    expect(guardWouldPass(55, null, { passThreshold: 60 })).toBe(false);
  });

  it("accepts a score at or above the candidate threshold", () => {
    expect(guardWouldPass(60, null, { passThreshold: 60 })).toBe(true);
    expect(guardWouldPass(90, null, { passThreshold: 60 })).toBe(true);
  });

  it("requires every named check to be true when requireChecks is given", () => {
    const config = { passThreshold: 60, requireChecks: ["notHoneypot", "mintAuthorityRenounced"] };
    expect(guardWouldPass(80, { notHoneypot: true, mintAuthorityRenounced: true }, config)).toBe(true);
    expect(guardWouldPass(80, { notHoneypot: true, mintAuthorityRenounced: false }, config)).toBe(false);
    expect(guardWouldPass(80, { notHoneypot: true }, config)).toBe(false);
    expect(guardWouldPass(80, null, config)).toBe(false);
  });
});
