import { describe, expect, it } from "vitest";
import { PaperBroker } from "./paper.js";

describe("PaperBroker", () => {
  it("keeps paper accounting isolated from chain execution", () => {
    const broker = new PaperBroker({
      startingBalanceUsd: 1000,
      feeBps: 50,
      slippageBps: 50,
      maxPositionUsd: 100,
    });
    const position = broker.buy({
      chain: "solana",
      tokenAddress: "TEST",
      strategy: "momentum",
      priceUsd: 1,
      timestamp: 1,
    });
    expect(position).not.toBeNull();
    expect(broker.getBalanceUsd()).toBe(900);

    broker.mark(position!.id, 1.5);
    const closed = broker.sell(position!.id, 1.5, "take_profit", 2);

    expect(closed.status).toBe("closed");
    expect(closed.returnPct).toBeGreaterThan(40);
    expect(broker.getTrades()).toHaveLength(2);
  });

  it("refuses paper orders when the configured virtual position limit is zero", () => {
    const broker = new PaperBroker({
      startingBalanceUsd: 1000,
      feeBps: 50,
      slippageBps: 50,
      maxPositionUsd: 0,
    });
    expect(broker.buy({
      chain: "solana",
      tokenAddress: "TEST",
      strategy: "conservative",
      priceUsd: 1,
    })).toBeNull();
  });
});
