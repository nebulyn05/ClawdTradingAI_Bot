import { describe, it, expect } from "vitest";
import { classifyOutcome, aggregateByVersion, splitRollingByVersion, detectDrift } from "./drift.js";

describe("classifyOutcome", () => {
  it("classifies guard_exit as rugged", () => {
    expect(classifyOutcome("guard_exit")).toBe("rugged");
  });

  it("classifies take_profit as performed_well", () => {
    expect(classifyOutcome("take_profit")).toBe("performed_well");
  });

  it("classifies stop_loss and manual as neutral", () => {
    expect(classifyOutcome("stop_loss")).toBe("neutral");
    expect(classifyOutcome("manual")).toBe("neutral");
  });
});

describe("aggregateByVersion", () => {
  it("buckets and computes accuracy per version", () => {
    const records = [
      { version: "v1", outcome: "performed_well" as const },
      { version: "v1", outcome: "performed_well" as const },
      { version: "v1", outcome: "rugged" as const },
      { version: "v1", outcome: "neutral" as const },
      { version: "v2", outcome: "rugged" as const },
    ];
    const result = aggregateByVersion(records);
    const v1 = result.find((r) => r.version === "v1")!;
    const v2 = result.find((r) => r.version === "v2")!;

    expect(v1.total).toBe(4);
    expect(v1.rugged).toBe(1);
    expect(v1.performedWell).toBe(2);
    expect(v1.neutral).toBe(1);
    expect(v1.accuracy).toBeCloseTo(0.75);

    expect(v2.total).toBe(1);
    expect(v2.accuracy).toBe(0);
  });

  it("returns an empty array for no records", () => {
    expect(aggregateByVersion([])).toEqual([]);
  });
});

describe("splitRollingByVersion", () => {
  it("keeps the most recent N per version as rolling, the rest as baseline", () => {
    const records = Array.from({ length: 10 }, (_, i) => ({
      version: "v1",
      outcome: "neutral" as const,
      closedAtMs: i,
    }));
    const { rolling, baseline } = splitRollingByVersion(records, 3);
    expect(rolling).toHaveLength(3);
    expect(rolling.map((r) => r.closedAtMs)).toEqual([7, 8, 9]);
    expect(baseline).toHaveLength(7);
  });

  it("splits independently per version rather than by one global cutoff", () => {
    const records = [
      ...Array.from({ length: 5 }, (_, i) => ({ version: "v1", outcome: "neutral" as const, closedAtMs: i })),
      ...Array.from({ length: 5 }, (_, i) => ({ version: "v2", outcome: "neutral" as const, closedAtMs: i + 100 })),
    ];
    const { rolling } = splitRollingByVersion(records, 2);
    const v1Rolling = rolling.filter((r) => r.version === "v1");
    const v2Rolling = rolling.filter((r) => r.version === "v2");
    expect(v1Rolling).toHaveLength(2);
    expect(v2Rolling).toHaveLength(2);
  });

  it("puts everything in rolling when there's less history than the window size", () => {
    const records = [{ version: "v1", outcome: "neutral" as const, closedAtMs: 1 }];
    const { rolling, baseline } = splitRollingByVersion(records, 10);
    expect(rolling).toHaveLength(1);
    expect(baseline).toHaveLength(0);
  });
});

describe("detectDrift", () => {
  it("flags a version whose rolling accuracy dropped more than the threshold below baseline", () => {
    const rolling = [{ version: "v1", total: 10, rugged: 5, performedWell: 5, neutral: 0, accuracy: 0.5 }];
    const baseline = [{ version: "v1", total: 20, rugged: 2, performedWell: 18, neutral: 0, accuracy: 0.9 }];
    const alerts = detectDrift(rolling, baseline, 0.15);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.version).toBe("v1");
    expect(alerts[0]!.dropPct).toBeCloseTo(0.4);
  });

  it("does not flag a drop within the threshold", () => {
    const rolling = [{ version: "v1", total: 10, rugged: 1, performedWell: 9, neutral: 0, accuracy: 0.9 }];
    const baseline = [{ version: "v1", total: 20, rugged: 2, performedWell: 18, neutral: 0, accuracy: 0.95 }];
    expect(detectDrift(rolling, baseline, 0.15)).toEqual([]);
  });

  it("skips versions without enough samples in either window", () => {
    const rolling = [{ version: "v1", total: 2, rugged: 2, performedWell: 0, neutral: 0, accuracy: 0 }];
    const baseline = [{ version: "v1", total: 20, rugged: 0, performedWell: 20, neutral: 0, accuracy: 1 }];
    expect(detectDrift(rolling, baseline, 0.15, 5)).toEqual([]);
  });

  it("skips a version with no baseline history at all", () => {
    const rolling = [{ version: "v2", total: 10, rugged: 5, performedWell: 5, neutral: 0, accuracy: 0.5 }];
    expect(detectDrift(rolling, [], 0.15)).toEqual([]);
  });
});
