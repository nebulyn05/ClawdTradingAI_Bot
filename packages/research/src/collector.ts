import { eventBus, createLogger, type NewPairEvent, type SafetyCheckResult } from "@clawd/core";
import { getDb } from "@clawd/db";
import { buildSnapshot } from "./features.js";
import { defaultStrategies } from "./strategies.js";
import { executePaperSignal } from "./paper-executor.js";
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
  if (existing) {
    const incomingPair = pair.pairAddress && pair.pairAddress !== pair.tokenAddress ? pair.pairAddress : undefined;
    const needsPairUpdate = Boolean(incomingPair && existing.pairAddress !== incomingPair);
    const needsDexUpdate = Boolean(pair.dex && existing.dex !== pair.dex);
    if (needsPairUpdate || needsDexUpdate) {
      const updated = await db.researchOpportunity.update({
        where: { id: existing.id },
        data: {
          ...(incomingPair ? { pairAddress: incomingPair } : {}),
          ...(pair.dex ? { dex: pair.dex } : {}),
        },
      });
      log.info({
        opportunityId: updated.id,
        tokenAddress: pair.tokenAddress,
        previousPairAddress: existing.pairAddress,
        pairAddress: updated.pairAddress,
      }, "Research opportunity pair address synchronized");
    }
    return existing.id;
  }

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

  const signalSummary: Array<{ strategy: string; decision: string; score: number; confidence: number }> = [];

  for (const strategy of defaultStrategies) {
    const signal = strategy.evaluate(snapshot);
    signalSummary.push({ strategy: signal.strategy, decision: signal.decision, score: signal.score, confidence: signal.confidence });
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

    await executePaperSignal({
      opportunityId,
      strategy: signal.strategy.replace("-", "_") as "conservative" | "momentum" | "early_entry" | "speculative",
      decision: signal.decision,
      chain: observation.chain,
      tokenAddress: observation.tokenAddress,
      priceUsd: observation.priceUsd,
      generatedAt: new Date(signal.generatedAt),
    });
  }

  log.info({
    opportunityId,
    tokenAddress: observation.tokenAddress,
    safetyScore: snapshot.safetyScore,
    safetyLevel: snapshot.safetyLevel,
    safetyPassed: snapshot.safetyPassed,
    priceUsd: observation.priceUsd,
    liquidityUsd: observation.liquidityUsd,
    volumeUsd: observation.volumeUsd,
    buyCount: observation.buyCount,
    sellCount: observation.sellCount,
    priceVelocityPct: observation.priceVelocityPct,
    priceAccelerationPct: observation.priceAccelerationPct,
    signals: signalSummary,
  }, "Research strategy evaluation");
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
        log.info({
          chain: pair.chain,
          tokenAddress: pair.tokenAddress,
          pairAddress: pair.pairAddress,
          dex: pair.dex,
          opportunityId: id,
        }, "Research opportunity recorded");
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
