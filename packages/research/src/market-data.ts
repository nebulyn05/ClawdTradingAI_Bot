import { createLogger, eventBus, type NewPairEvent } from "@clawd/core";
import { getDb } from "@clawd/db";
import { recordMarketObservation } from "./collector.js";
import type { MarketObservation } from "./types.js";
import { enrichSolanaSecurity } from "./security.js";

const log = createLogger("research:market-data");
const DEFAULT_INTERVAL_MS = 15_000;
const DEXSCREENER_BASE = "https://api.dexscreener.com";

type DexPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string };
  priceUsd?: string | null;
  txns?: Record<string, { buys?: number; sells?: number }>;
  volume?: Record<string, number>;
  liquidity?: { usd?: number | null };
  fdv?: number | null;
  marketCap?: number | null;
  pairCreatedAt?: number | null;
};

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pickPeriod<T>(value: Record<string, T> | undefined, period: string): T | undefined {
  return value?.[period] ?? value?.m5 ?? value?.m15 ?? value?.h1;
}

async function fetchPair(pairAddress: string): Promise<DexPair | null> {
  const headers = { accept: "application/json" };

  // Pump.fun emits the mint as pairAddress. DEX Screener's pair endpoint
  // expects an actual pool/pair address, so fall back to token lookup when
  // the direct pair lookup returns no pair.
  const pairUrl = DEXSCREENER_BASE + "/latest/dex/pairs/solana/" + encodeURIComponent(pairAddress);
  const pairResponse = await fetch(pairUrl, { headers });
  if (!pairResponse.ok) throw new Error("DEX Screener pair HTTP " + pairResponse.status);
  const pairBody = (await pairResponse.json()) as { pairs?: DexPair[] | null };
  const directPair = pairBody.pairs?.[0];
  if (directPair) return directPair;

  const tokenUrl = DEXSCREENER_BASE + "/latest/dex/tokens/" + encodeURIComponent(pairAddress);
  const tokenResponse = await fetch(tokenUrl, { headers });
  if (!tokenResponse.ok) throw new Error("DEX Screener token HTTP " + tokenResponse.status);
  const tokenBody = (await tokenResponse.json()) as { pairs?: DexPair[] | null };
  return tokenBody.pairs?.find((candidate) => candidate.chainId === "solana") ?? tokenBody.pairs?.[0] ?? null;
}

function buildObservation(pair: DexPair, previous?: { priceUsd: number | null; liquidityUsd: number | null; observedAt: Date }): MarketObservation | null {
  const tokenAddress = pair.baseToken?.address;
  const priceUsd = Number(pair.priceUsd);
  if (!tokenAddress || !Number.isFinite(priceUsd) || priceUsd <= 0) return null;

  const now = Date.now();
  const previousPrice = previous?.priceUsd ?? undefined;
  const previousLiquidity = previous?.liquidityUsd ?? undefined;
  const velocity = previousPrice !== undefined && previous?.observedAt ? ((priceUsd / previousPrice) - 1) * 100 : undefined;
  const liquidity = finite(pair.liquidity?.usd);
  const buys = finite((pickPeriod(pair.txns, "m5") ?? {}).buys);
  const sells = finite((pickPeriod(pair.txns, "m5") ?? {}).sells);
  const volume = finite(pickPeriod(pair.volume, "m5"));
  const liquidityChangePct = previousLiquidity && liquidity !== undefined ? ((liquidity / previousLiquidity) - 1) * 100 : undefined;
  const walletActivityScore = buys !== undefined || sells !== undefined
    ? Math.max(0, Math.min(100, ((buys ?? 0) - (sells ?? 0)) / Math.max(1, (buys ?? 0) + (sells ?? 0)) * 50 + 50))
    : undefined;

  return {
    chain: "solana",
    tokenAddress,
    pairAddress: pair.pairAddress,
    dex: pair.dexId,
    observedAt: now,
    launchTime: pair.pairCreatedAt ?? undefined,
    priceUsd,
    liquidityUsd: liquidity,
    marketCapUsd: finite(pair.marketCap) ?? finite(pair.fdv),
    volumeUsd: volume,
    buyCount: buys,
    sellCount: sells,
    liquidityChangePct,
    walletActivityScore,
    priceVelocityPct: velocity,
  };
}

export interface MarketDataCollectorConfig { intervalMs?: number; maxPairsPerTick?: number; }

export function startSolanaMarketDataCollector(config: MarketDataCollectorConfig = {}): () => void {
  const intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxPairsPerTick = config.maxPairsPerTick ?? 100;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const running = new Set<string>();

  const tick = async () => {
    if (stopped) return;
    const db = getDb();
    const opportunities = await db.researchOpportunity.findMany({
      where: { chain: "solana" }, orderBy: { detectedAt: "desc" }, take: maxPairsPerTick,
    });
    let skippedNoPairAddress = 0;
    let refreshed = 0;
    let noDexPair = 0;
    let failures = 0;

    await Promise.allSettled(opportunities.map(async (opportunity) => {
      if (!opportunity.pairAddress) {
        skippedNoPairAddress += 1;
        return;
      }
      if (running.has(opportunity.id)) return;
      running.add(opportunity.id);
      try {
        const pair = await fetchPair(opportunity.pairAddress);
        if (!pair) {
          noDexPair += 1;
          return;
        }
        const previous = await db.researchObservation.findFirst({
          where: { opportunityId: opportunity.id, priceUsd: { not: null } },
          orderBy: { observedAt: "desc" },
          select: { priceUsd: true, liquidityUsd: true, observedAt: true },
        });
        let observation = buildObservation(pair, previous ?? undefined);
        if (!observation) return;
        observation = await enrichSolanaSecurity(observation);
        await recordMarketObservation(opportunity.id, observation);
        refreshed += 1;
      } catch (err) {
        failures += 1;
        log.warn({ err, opportunityId: opportunity.id, pairAddress: opportunity.pairAddress }, "Failed to refresh Solana market data");
      } finally { running.delete(opportunity.id); }
    }));

    log.info({
      opportunities: opportunities.length,
      refreshed,
      noDexPair,
      skippedNoPairAddress,
      failures,
    }, "Solana market-data tick");
  };

  const onPair = (_pair: NewPairEvent) => { void tick(); };
  const unsubscribe = eventBus.on("sniper.newPair", onPair);
  void tick();
  timer = setInterval(() => void tick(), intervalMs);
  log.info({ intervalMs, maxPairsPerTick }, "Solana market-data collector started");
  return () => { stopped = true; unsubscribe(); if (timer) clearInterval(timer); };
}
