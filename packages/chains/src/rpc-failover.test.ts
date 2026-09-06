import { describe, it, expect, vi, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

// rpc-failover.ts's createLogger call runs loadConfig() at import time —
// see CLAUDE.md's note on this repo's test convention.
beforeAll(() => {
  process.env.MASTER_ENCRYPTION_KEY ??= randomBytes(32).toString("hex");
  process.env.DATABASE_URL ??= "postgresql://clawd:clawd@localhost:5432/clawd_agents";
  process.env.REDIS_URL ??= "redis://localhost:6379";
});

interface FakeClient {
  endpoint: string;
  ping(): Promise<string>;
  other(): string;
}

function fakeClient(endpoint: string, overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    endpoint,
    ping: overrides.ping ?? (async () => endpoint),
    other: overrides.other ?? (() => "unwrapped"),
  };
}

describe("parseRpcUrlList", () => {
  it("splits, trims, and drops empty entries", async () => {
    const { parseRpcUrlList } = await import("./rpc-failover.js");
    expect(parseRpcUrlList("https://a.com, https://b.com ,,https://c.com")).toEqual([
      "https://a.com",
      "https://b.com",
      "https://c.com",
    ]);
  });

  it("returns an empty array for undefined or empty input", async () => {
    const { parseRpcUrlList } = await import("./rpc-failover.js");
    expect(parseRpcUrlList(undefined)).toEqual([]);
    expect(parseRpcUrlList("")).toEqual([]);
  });
});

describe("withRpcFailover", () => {
  it("returns the single instance unchanged when there's only one", async () => {
    const { withRpcFailover } = await import("./rpc-failover.js");
    const only = fakeClient("primary");
    const wrapped = withRpcFailover([only], ["ping"], "test", (c) => c.endpoint);
    expect(wrapped).toBe(only);
  });

  it("calls the primary when it succeeds, never touching the fallback", async () => {
    const { withRpcFailover } = await import("./rpc-failover.js");
    const fallbackPing = vi.fn(async () => "fallback");
    const primary = fakeClient("primary");
    const fallback = fakeClient("fallback", { ping: fallbackPing });
    const wrapped = withRpcFailover([primary, fallback], ["ping"], "test", (c) => c.endpoint);

    await expect(wrapped.ping()).resolves.toBe("primary");
    expect(fallbackPing).not.toHaveBeenCalled();
  });

  it("falls back to the next instance when the primary throws", async () => {
    const { withRpcFailover } = await import("./rpc-failover.js");
    const primary = fakeClient("primary", {
      ping: async () => {
        throw new Error("down");
      },
    });
    const fallback = fakeClient("fallback");
    const wrapped = withRpcFailover([primary, fallback], ["ping"], "test", (c) => c.endpoint);

    await expect(wrapped.ping()).resolves.toBe("fallback");
  });

  it("throws the last error once every instance has failed", async () => {
    const { withRpcFailover } = await import("./rpc-failover.js");
    const primary = fakeClient("primary", {
      ping: async () => {
        throw new Error("primary down");
      },
    });
    const fallback = fakeClient("fallback", {
      ping: async () => {
        throw new Error("fallback down");
      },
    });
    const wrapped = withRpcFailover([primary, fallback], ["ping"], "test", (c) => c.endpoint);

    await expect(wrapped.ping()).rejects.toThrow("fallback down");
  });

  it("passes methods not named in the failover list straight through to the primary", async () => {
    const { withRpcFailover } = await import("./rpc-failover.js");
    const primary = fakeClient("primary");
    const fallback = fakeClient("fallback");
    const wrapped = withRpcFailover([primary, fallback], ["ping"], "test", (c) => c.endpoint);

    expect(wrapped.other()).toBe("unwrapped");
  });
});
