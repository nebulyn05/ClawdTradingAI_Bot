import { eventBus, createLogger, type NewPairEvent, type SafetyCheckResult } from "@clawd/core";
import { getDb } from "@clawd/db";
import { buildSnapshot } from "./features.js";
import { defaultStrategies } from "./strategies.js";
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

export async function recordMarketObservation(opportunityId: string, observation: MarketObservation): Promise<void> {
  const db = getDb();
  const safety = await db.safetyCheck.findFirst({
    where: { chain: observation.chain, tokenAddress: observation.tokenAddress },
    select: { score: true, passed: true },
  });
  await persistObservation(
    opportunityId,
    observation,
    safety ? { score: safety.score, passed: safety.passed } as SafetyCheckResult : undefined,
  );
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
    const key = result.chain + ":" + result.tokenAddress;
    safety.set(key, result);
    void (async () => {
      try {
        const opportunityId = opportunities.get(key);
        if (!opportunityId) return;
        const db = getDb();
        const latest = await db.researchObservation.findFirst({
          where: { opportunityId },
          orderBy: { observedAt: "desc" },
        });
        if (!latest) return;
        await db.researchObservation.update({
          where: { id: latest.id },
          data: {
            safetyScore: result.score,
            safetyLevel: result.passed ? (result.score >= 90 ? 4 : result.score >= 75 ? 3 : result.score >= 60 ? 2 : 1) : 0,
            safetyPassed: result.passed,
            rugIndicators: Object.entries(result.checks)
              .filter(([, passed]) => !passed)
              .map(([check]) => check),
          },
        });
      } catch (err) {
        log.warn({ err, chain: result.chain, tokenAddress: result.tokenAddress }, "Failed to attach Guard result to research observation");
      }
    })();
  };

  const stopPair = eventBus.on("sniper.newPair", onPair);
  const stopGuard = eventBus.on("guard.result", onGuard);
  return () => { stopPair(); stopGuard(); };
}
