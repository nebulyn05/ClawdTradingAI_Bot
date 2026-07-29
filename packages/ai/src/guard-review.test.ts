import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

beforeAll(() => {
  process.env.MASTER_ENCRYPTION_KEY ??= randomBytes(32).toString("hex");
  process.env.DATABASE_URL ??= "postgresql://clawd:clawd@localhost:5432/clawd_agents";
  process.env.REDIS_URL ??= "redis://localhost:6379";
  // Explicitly off — these tests exercise the disabled fail-safe path, not a real API call.
  process.env.AI_FEATURES_ENABLED = "false";
});

describe("reviewTokenWithAi", () => {
  it("approves by default when AI features are disabled, deferring to the mechanical result", async () => {
    const { reviewTokenWithAi } = await import("./guard-review.js");
    const review = await reviewTokenWithAi("solana", "someTokenAddress", {
      chain: "solana",
      tokenAddress: "someTokenAddress",
      passed: true,
      score: 90,
      checks: {},
      reasons: [],
      checkedAt: Date.now(),
    });
    expect(review.approved).toBe(true);
    expect(review.reasoning).toMatch(/disabled/i);
  });
});

describe("reviewTpSlWithAi", () => {
  it("returns null (keep current targets) when AI features are disabled", async () => {
    const { reviewTpSlWithAi } = await import("./tp-sl-review.js");
    const review = await reviewTpSlWithAi("solana", 1, 1.1, 0.5, 0.2, 90, 60_000);
    expect(review).toBeNull();
  });
});
