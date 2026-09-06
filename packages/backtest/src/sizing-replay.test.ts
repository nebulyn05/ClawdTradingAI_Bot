import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import type { HistoricalSignal } from "./types.js";

// @clawd/router's own createLogger call runs loadConfig() at import time, so
// these env vars must exist before any (transitive) import of that package —
// see CLAUDE.md's note on this repo's test convention.
beforeAll(() => {
  process.env.MASTER_ENCRYPTION_KEY ??= randomBytes(32).toString("hex");
  process.env.DATABASE_URL ??= "postgresql://clawd:clawd@localhost:5432/clawd_agents";
  process.env.REDIS_URL ??= "redis://localhost:6379";
});

function signal(overrides: Partial<HistoricalSignal> = {}): HistoricalSignal {
  return {
    positionId: "p1",
    source: "sniper",
    chain: "solana",
    tokenAddress: "token1",
    openedAt: new Date("2026-01-01"),
    guardScore: 90,
    guardChecks: null,
    returnPct: 0.5,
    profitAmountRaw: 200n,
    actualSizeRaw: 400n,
    profitable: true,
    ...overrides,
  };
}

describe("replaySizing", () => {
  it(
    "falls back to the flat default size when the category has no train-window history",
    async () => {
      // First test in the file to import @clawd/router, which transitively
      // pulls in @clawd/chains' viem/@solana-web3.js — slow enough under
      // parallel test-runner load to occasionally exceed the 5s default.
      const { replaySizing } = await import("./sizing-replay.js");
      const test = [signal()];
      const weights = replaySizing([], test, {
        kellyFraction: 0.25,
        maxPositionPct: 0.5,
        startingBalanceRaw: 1_000n,
        fallbackSizePct: 0.05,
      });
      expect(weights).toHaveLength(1);
      expect(weights[0]).toBeCloseTo(0.05);
    },
    15_000,
  );

  it("sizes test trades using stats derived only from train-window trades", async () => {
    const { replaySizing } = await import("./sizing-replay.js");
    // Train: 3 wins of 200, 2 losses of -100 -> winRate 0.6, ratio 2 -> f*=0.4.
    const train = [
      signal({ profitable: true, profitAmountRaw: 200n }),
      signal({ profitable: true, profitAmountRaw: 200n }),
      signal({ profitable: true, profitAmountRaw: 200n }),
      signal({ profitable: false, profitAmountRaw: -100n }),
      signal({ profitable: false, profitAmountRaw: -100n }),
    ];
    const test = [signal()];
    const weights = replaySizing(train, test, {
      kellyFraction: 0.25,
      maxPositionPct: 0.5,
      startingBalanceRaw: 1_000n,
    });
    // Quarter-Kelly of a 40% edge -> 10% of bankroll.
    expect(weights[0]).toBeCloseTo(0.1);
  });

  it("returns a zero weight for a category with negative expectancy", async () => {
    const { replaySizing } = await import("./sizing-replay.js");
    const train = [
      signal({ profitable: true, profitAmountRaw: 100n }),
      signal({ profitable: false, profitAmountRaw: -100n }),
      signal({ profitable: false, profitAmountRaw: -100n }),
      signal({ profitable: false, profitAmountRaw: -100n }),
      signal({ profitable: false, profitAmountRaw: -100n }),
    ];
    const test = [signal()];
    const weights = replaySizing(train, test, {
      kellyFraction: 0.25,
      maxPositionPct: 0.5,
      startingBalanceRaw: 1_000n,
    });
    expect(weights[0]).toBe(0);
  });

  it("keeps categories separate — one category's stats don't leak into another's sizing", async () => {
    const { replaySizing } = await import("./sizing-replay.js");
    const train = [
      // sniper: strong positive edge
      signal({ source: "sniper", profitable: true, profitAmountRaw: 300n }),
      signal({ source: "sniper", profitable: true, profitAmountRaw: 300n }),
      signal({ source: "sniper", profitable: true, profitAmountRaw: 300n }),
      signal({ source: "sniper", profitable: false, profitAmountRaw: -100n }),
      signal({ source: "sniper", profitable: false, profitAmountRaw: -100n }),
      // scout: negative edge
      signal({ source: "scout", profitable: true, profitAmountRaw: 100n }),
      signal({ source: "scout", profitable: false, profitAmountRaw: -100n }),
      signal({ source: "scout", profitable: false, profitAmountRaw: -100n }),
      signal({ source: "scout", profitable: false, profitAmountRaw: -100n }),
      signal({ source: "scout", profitable: false, profitAmountRaw: -100n }),
    ];
    const test = [signal({ source: "sniper" }), signal({ source: "scout" })];
    const weights = replaySizing(train, test, {
      kellyFraction: 0.25,
      maxPositionPct: 0.5,
      startingBalanceRaw: 1_000n,
    });
    expect(weights[0]).toBeGreaterThan(0);
    expect(weights[1]).toBe(0);
  });
});
