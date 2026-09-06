import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import type { HistoricalSignal } from "./types.js";

// replay.ts imports sizing-replay.js, which imports @clawd/router — whose
// createLogger call runs loadConfig() at import time. See sizing-replay.test.ts.
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

describe("runBacktest", () => {
  it(
    "reports full nominal returns when no guard or sizing config is given",
    async () => {
      // First test in the file to import @clawd/router (see sizing-replay.test.ts).
      const { runBacktest } = await import("./replay.js");
      const signals = [signal({ returnPct: 0.5 }), signal({ returnPct: -0.2, profitable: false })];
      const report = runBacktest(signals, {});
      expect(report.tradesConsidered).toBe(2);
      expect(report.tradesTaken).toBe(2);
      expect(report.winRate).toBeCloseTo(0.5);
      expect(report.totalReturnPct).toBeCloseTo(1.5 * 0.8 - 1); // compounded: 1 * 1.5 * 0.8 - 1 = 0.2
    },
    15_000,
  );

  it("excludes signals the candidate Guard rule-set would have rejected", async () => {
    const { runBacktest } = await import("./replay.js");
    const signals = [
      signal({ guardScore: 90, returnPct: 0.5 }),
      signal({ guardScore: 30, returnPct: -0.9 }), // would have been rejected — its huge loss shouldn't count
    ];
    const report = runBacktest(signals, { guard: { passThreshold: 60 } });
    expect(report.tradesConsidered).toBe(2);
    expect(report.tradesTaken).toBe(1);
    expect(report.totalReturnPct).toBeCloseTo(0.5);
  });

  it("only reports metrics from the test window when a split is given", async () => {
    const { runBacktest } = await import("./replay.js");
    const train = [
      signal({ openedAt: new Date("2026-01-01"), profitable: true, profitAmountRaw: 300n }),
      signal({ openedAt: new Date("2026-01-02"), profitable: true, profitAmountRaw: 300n }),
      signal({ openedAt: new Date("2026-01-03"), profitable: true, profitAmountRaw: 300n }),
      signal({ openedAt: new Date("2026-01-04"), profitable: false, profitAmountRaw: -100n }),
      signal({ openedAt: new Date("2026-01-05"), profitable: false, profitAmountRaw: -100n }),
    ];
    const test = [signal({ openedAt: new Date("2026-02-01"), returnPct: 0.3 })];

    const report = runBacktest([...train, ...test], {
      sizing: { kellyFraction: 0.25, maxPositionPct: 0.5, startingBalanceRaw: 1_000n },
      split: {
        trainStart: new Date("2026-01-01"),
        trainEnd: new Date("2026-01-06"),
        testStart: new Date("2026-02-01"),
        testEnd: new Date("2026-02-02"),
      },
    });

    expect(report.tradesConsidered).toBe(1);
    expect(report.tradesTaken).toBe(1);
    // Quarter-Kelly of the train-derived 0.4 edge -> 10% weight on a 0.3 return.
    expect(report.totalReturnPct).toBeCloseTo(0.03);
  });

  it("drops a trade sizing rejects (negative expectancy) from the reported metrics", async () => {
    const { runBacktest } = await import("./replay.js");
    // winRate 0.4, avgWin 50 / avgLoss 100 -> f* = 0.4 - 0.6/0.5 = -0.8: negative expectancy.
    const train = [
      signal({ openedAt: new Date("2026-01-01"), profitable: true, profitAmountRaw: 50n }),
      signal({ openedAt: new Date("2026-01-02"), profitable: true, profitAmountRaw: 50n }),
      signal({ openedAt: new Date("2026-01-03"), profitable: false, profitAmountRaw: -100n }),
      signal({ openedAt: new Date("2026-01-04"), profitable: false, profitAmountRaw: -100n }),
      signal({ openedAt: new Date("2026-01-05"), profitable: false, profitAmountRaw: -100n }),
    ];
    const test = [signal({ openedAt: new Date("2026-02-01"), returnPct: 0.9 })];

    const report = runBacktest([...train, ...test], {
      sizing: { kellyFraction: 0.25, maxPositionPct: 0.5, startingBalanceRaw: 1_000n },
      split: {
        trainStart: new Date("2026-01-01"),
        trainEnd: new Date("2026-01-06"),
        testStart: new Date("2026-02-01"),
        testEnd: new Date("2026-02-02"),
      },
    });

    expect(report.tradesTaken).toBe(0);
    expect(report.totalReturnPct).toBe(0);
  });
});
