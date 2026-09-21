import { eventBus, createLogger, type NewPairEvent, type SafetyCheckResult } from "@clawd/core";
import { getDb } from "@clawd/db";
import { buildSnapshot, defaultStrategies } from "./index.js";
import type { MarketObservation } from "./types.js";

const log = createLogger("research:collector");

function observationFromPair(pair: NewPairEvent): MarketObservation {
  return {
    chain: pair.chain,
    tokenAddress: pair.tokenAddress,
    pairAddress: pair.pairAddress,
    dex: pair.dex,
    observedAt: pair.detectedAt,
    launchTime: pair.detectedAt,
  };
}

async function persistPair(pair: NewPairEvent): Promise<string> {
  const db = getDb();
  const existing = await db.researchOpportunity.findFirst({
    where: { chain: pair.chain, tokenAddress: pair.tokenAddress },
    orderBy: { detectedAt: "asc" },
  });
  if (existing) return existing.id;

  const created = await db.researchOpportunity.create({
    data: {
      chain: pair.chain,
      tokenAddress: pair.tokenAddress,
      pairAddress: pair.pairAddress,
      dex: pair.dex,
      source: "sniper",
      detectedAt: new Date(pair.detectedAt),
      launchTime: new Date(pair.detectedAt),
    },
  });
  return created.id;
}

async function persistObservation(opportunityId: string, observation: MarketObservation, safety?: SafetyCheckResult) {
  const db = getDb();
  const snapshot = buildSnapshot(observation, safety?.score ?? 0, safety?.passed ?? false);

  await db.researchObservation.create({
    data: {
      opportunityId,
      observedAt: new Date(observation.observedAt),
      priceUsd: observation.priceUsd,
      liquidityUsd: observation.liquidityUsd,
      marketCapUsd: observation.marketCapUsd,
      volumeUsd: observation.volumeUsd,
      buyCount: observation.buyCount,
      sellCount: observation.sellCount,
      uniqueBuyers: observation.uniqueBuyers,
      uniqueSellers: observation.uniqueSellers,
      holderCount: observation.holderCount,
      top10HolderPct: observation.top10HolderPct,
      creatorWallet: observation.creatorWallet,
      creatorLaunches: observation.creatorHistory?.launches,
      creatorRugs: observation.creatorHistory?.rugs,
      creatorSuccessful: observation.creatorHistory?.successfulLaunches,
      liquidityChangePct: observation.liquidityChangePct,
      walletActivityScore: observation.walletActivityScore,
      priceVelocityPct: observation.priceVelocityPct,
      priceAccelerationPct: observation.priceAccelerationPct,
      rugIndicators: observation.rugIndicators ?? [],
      safetyScore: snapshot.safetyScore,
      safetyLevel: snapshot.safetyLevel,
      safetyPassed: snapshot.safetyPassed,
      features: snapshot.features,
    },
  });

  for (const strategy of defaultStrategies) {
    const signal = strategy.evaluate(snapshot);
    await db.researchSignal.create({
      data: {
        opportunityId,
        strategy: signal.strategy.replace("-", "_") as "conservative" | "momentum" | "early_entry" | "speculative",
        decision: signal.decision,
        score: signal.score,
        confidence: signal.confidence,
        reasons: signal.reasons,
        generatedAt: new Date(signal.generatedAt),
      },
    });
  }
}

export function startResearchCollector(): () => void {
  const opportunities = new Map<string, string>();
  const safety = new Map<string, SafetyCheckResult>();

  const onPair = (pair: NewPairEvent) => {
    void (async () => {
      try {
        const key = pair.chain + ":" + pair.tokenAddress;
        const id = await persistPair(pair);
        opportunities.set(key, id);
        await persistObservation(id, observationFromPair(pair), safety.get(key));
        log.info({ chain: pair.chain, tokenAddress: pair.tokenAddress, opportunityId: id }, "Research opportunity recorded");
      } catch (err) {
        log.error({ err, chain: pair.chain, tokenAddress: pair.tokenAddress }, "Failed to record research opportunity");
      }
    })();
  };

  const onGuard = (result: SafetyCheckResult) => {
    safety.set(result.chain + ":" + result.tokenAddress, result);
  };

  const stopPair = eventBus.on("sniper.newPair", onPair);
  const stopGuard = eventBus.on("guard.result", onGuard);
  return () => { stopPair(); stopGuard(); };
}
