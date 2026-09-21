import { createLogger, eventBus, type NewPairEvent } from "@clawd/core";
import { getDb } from "@clawd/db";
import { Connection, PublicKey } from "@solana/web3.js";
import { recordMarketObservation } from "./collector.js";
import type { MarketObservation } from "./types.js";
import { enrichSolanaSecurity } from "./security.js";

const log = createLogger("research:market-data");
const DEFAULT_INTERVAL_MS = 15_000;
const DEXSCREENER_BASE = "https://api.dexscreener.com";
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet.solana.com";
const SOLANA_RPC_FALLBACK_URLS = [
  process.env.SOLANA_RPC_FALLBACK_URL,
  "https://solana-rpc.publicnode.com",
].filter((url): url is string => Boolean(url) && url !== SOLANA_RPC_URL);
const SOL_PRICE_MINT = "So11111111111111111111111111111111111111112";
const SOL_PRICE_URL = process.env.SOL_PRICE_URL || "https://lite-api.jup.ag/price/v3?ids=" + SOL_PRICE_MINT;
const SOL_PRICE_FALLBACK_URLS = [
  process.env.SOL_PRICE_FALLBACK_URL,
  "https://api.coinbase.com/v2/prices/SOL-USD/spot",
  "https://api.kraken.com/0/public/Ticker?pair=SOLUSD",
].filter((url): url is string => Boolean(url));
const PUMP_FUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const LAMPORTS_PER_SOL = 1_000_000_000;
const TOKEN_DECIMALS = 6;
const SOL_PRICE_TTL_MS = 60_000;
const DEX_ENRICHMENT_TTL_MS = 60_000;

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

type PumpCurveState = {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: string;
};

const solana = new Connection(SOLANA_RPC_URL, "confirmed");
const solanaFallbacks = SOLANA_RPC_FALLBACK_URLS.map((url) => ({
  url,
  connection: new Connection(url, "confirmed"),
}));
let cachedSolPriceUsd: number | undefined;
let cachedSolPriceAt = 0;
const dexLastEnrichment = new Map<string, number>();

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pickPeriod<T>(value: Record<string, T> | undefined, period: string): T | undefined {
  return value?.[period] ?? value?.m5 ?? value?.m15 ?? value?.h1;
}

function readU64(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
}

function derivePumpBondingCurve(mint: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_FUN_PROGRAM_ID,
  );
  return address;
}

function parsePumpCurve(data: Buffer): PumpCurveState | null {
  // Anchor discriminator + u64 reserves + bool + creator pubkey.
  // Current Pump.fun curves are at least 82 bytes; accepting the legacy
  // 49-byte prefix keeps the parser compatible with older curve accounts.
  if (data.length < 49) return null;
  const discriminator = data.subarray(0, 8).toString("hex");
  if (discriminator !== "17b7f83760d8ac60") return null;

  try {
    return {
      virtualTokenReserves: readU64(data, 8),
      virtualSolReserves: readU64(data, 16),
      realTokenReserves: readU64(data, 24),
      realSolReserves: readU64(data, 32),
      tokenTotalSupply: readU64(data, 40),
      complete: data[48] !== 0,
      creator: data.length >= 81 ? new PublicKey(data.subarray(49, 81)).toBase58() : "",
    };
  } catch {
    return null;
  }
}

async function fetchSolPriceUsd(): Promise<number | undefined> {
  const now = Date.now();
  if (cachedSolPriceUsd !== undefined && now - cachedSolPriceAt < SOL_PRICE_TTL_MS) {
    return cachedSolPriceUsd;
  }

  const urls = [SOL_PRICE_URL, ...SOL_PRICE_FALLBACK_URLS.filter((url) => url !== SOL_PRICE_URL)];
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("SOL price HTTP " + response.status);
      const body = await response.json() as Record<string, unknown>;

      let price: number | undefined;
      if (url.includes("jup.ag")) {
        const value = body[SOL_PRICE_MINT] as { usdPrice?: number | string } | undefined;
        price = finite(Number(value?.usdPrice));
      } else if (url.includes("coinbase.com")) {
        const value = body.data as { amount?: string } | undefined;
        price = finite(Number(value?.amount));
      } else if (url.includes("kraken.com")) {
        const result = body.result as Record<string, { c?: string[] }> | undefined;
        const ticker = result ? Object.values(result)[0] : undefined;
        price = finite(Number(ticker?.c?.[0]));
      }

      if (price !== undefined && price > 0) {
        cachedSolPriceUsd = price;
        cachedSolPriceAt = now;
        log.info({ source: url.includes("jup.ag") ? "jupiter" : url.includes("coinbase.com") ? "coinbase" : "kraken", priceUsd: price }, "SOL/USD price refreshed");
        return price;
      }
    } catch (err) {
      log.warn({ err, source: url }, "SOL/USD price provider failed");
    }
  }

  return cachedSolPriceUsd;
}

function parsePumpCurveAccount(account: Awaited<ReturnType<typeof solana.getAccountInfo>> | undefined): PumpCurveState | null {
  if (!account || !account.owner.equals(PUMP_FUN_PROGRAM_ID)) return null;
  return parsePumpCurve(Buffer.from(account.data));
}

async function fetchDexPair(pairAddress: string): Promise<DexPair | null> {
  const headers = { accept: "application/json" };

  try {
    const pairUrl = DEXSCREENER_BASE + "/latest/dex/pairs/solana/" + encodeURIComponent(pairAddress);
    const pairResponse = await fetch(pairUrl, { headers });
    if (!pairResponse.ok) return null;
    const pairBody = (await pairResponse.json()) as { pairs?: DexPair[] | null };
    const directPair = pairBody.pairs?.[0];
    if (directPair) return directPair;
  } catch {
    // Secondary enrichment must never block the on-chain collector.
  }

  try {
    const tokenUrl = DEXSCREENER_BASE + "/latest/dex/tokens/" + encodeURIComponent(pairAddress);
    const tokenResponse = await fetch(tokenUrl, { headers });
    if (!tokenResponse.ok) return null;
    const tokenBody = (await tokenResponse.json()) as { pairs?: DexPair[] | null };
    return tokenBody.pairs?.find((candidate) => candidate.chainId === "solana") ?? tokenBody.pairs?.[0] ?? null;
  } catch {
    return null;
  }
}

function buildPumpObservation(
  tokenAddress: string,
  curve: PumpCurveState,
  solPriceUsd: number | undefined,
  previous?: { priceUsd: number | null; liquidityUsd: number | null; observedAt: Date },
): MarketObservation | null {
  if (curve.complete || curve.virtualTokenReserves <= 0n || curve.virtualSolReserves <= 0n) return null;

  const priceSol = Number(curve.virtualSolReserves) / Number(curve.virtualTokenReserves);
  const priceUsd = solPriceUsd !== undefined ? priceSol * solPriceUsd : undefined;
  if (!Number.isFinite(priceSol) || priceSol <= 0) return null;

  const now = Date.now();
  const previousPrice = previous?.priceUsd ?? undefined;
  const velocity = priceUsd !== undefined && previousPrice !== undefined && previousPrice > 0
    ? ((priceUsd / previousPrice) - 1) * 100
    : undefined;

  const realSol = Number(curve.realSolReserves) / LAMPORTS_PER_SOL;
  const liquidityUsd = solPriceUsd !== undefined ? realSol * solPriceUsd * 2 : undefined;
  const liquidityChangePct = previous?.liquidityUsd && liquidityUsd !== undefined
    ? ((liquidityUsd / previous.liquidityUsd) - 1) * 100
    : undefined;

  const marketCapSol = Number(curve.tokenTotalSupply) / (10 ** TOKEN_DECIMALS) * priceSol;
  const marketCapUsd = solPriceUsd !== undefined ? marketCapSol * solPriceUsd : undefined;

  return {
    chain: "solana",
    tokenAddress,
    pairAddress: tokenAddress,
    dex: "pump.fun",
    observedAt: now,
    priceUsd,
    liquidityUsd,
    marketCapUsd,
    liquidityChangePct,
    priceVelocityPct: velocity,
    creatorWallet: curve.creator || undefined,
    rugIndicators: curve.complete ? ["bonding_curve_complete"] : [],
  };
}

function mergeDexEnrichment(base: MarketObservation, pair: DexPair): MarketObservation {
  const buys = finite((pickPeriod(pair.txns, "m5") ?? {}).buys);
  const sells = finite((pickPeriod(pair.txns, "m5") ?? {}).sells);
  const volume = finite(pickPeriod(pair.volume, "m5"));
  return {
    ...base,
    pairAddress: pair.pairAddress ?? base.pairAddress,
    dex: pair.dexId ?? base.dex,
    priceUsd: finite(Number(pair.priceUsd)) ?? base.priceUsd,
    liquidityUsd: finite(pair.liquidity?.usd) ?? base.liquidityUsd,
    marketCapUsd: finite(pair.marketCap) ?? finite(pair.fdv) ?? base.marketCapUsd,
    volumeUsd: volume ?? base.volumeUsd,
    buyCount: buys ?? base.buyCount,
    sellCount: sells ?? base.sellCount,
    launchTime: pair.pairCreatedAt ?? base.launchTime,
  };
}

export interface MarketDataCollectorConfig {
  intervalMs?: number;
  maxPairsPerTick?: number;
  maxDexEnrichmentsPerTick?: number;
}

export function startSolanaMarketDataCollector(config: MarketDataCollectorConfig = {}): () => void {
  const intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxPairsPerTick = config.maxPairsPerTick ?? 100;
  const maxDexEnrichmentsPerTick = config.maxDexEnrichmentsPerTick ?? 3;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const running = new Set<string>();

  const tick = async () => {
    if (stopped) return;
    const db = getDb();
    const opportunities = await db.researchOpportunity.findMany({
      where: { chain: "solana" }, orderBy: { detectedAt: "desc" }, take: maxPairsPerTick,
    });
    const solPriceUsd = await fetchSolPriceUsd();

    // Read both the deterministic PDA and the bonding-curve account captured
    // directly from the Pump.fun create instruction. The latter is important
    // for current create_v2 launches and also lets us recover opportunities
    // created by older watcher versions without trusting a stale pairAddress.
    const curveByToken = new Map<string, PumpCurveState | null>();
    const curveAddressByToken = new Map<string, string>();
    let curveAccountsFound = 0;
    let curveAccountsParsed = 0;
    try {
      const candidates = opportunities.map((opportunity) => {
        const derived = derivePumpBondingCurve(new PublicKey(opportunity.tokenAddress)).toBase58();
        const captured = opportunity.pairAddress;
        const addresses = captured && captured !== opportunity.tokenAddress
          ? [captured, derived]
          : [derived];
        return { opportunity, addresses: [...new Set(addresses)] };
      });
      const flatAddresses = [...new Set(candidates.flatMap((item) => item.addresses))].map((address) => new PublicKey(address));
      const accountByAddress = new Map<string, Awaited<ReturnType<typeof solana.getAccountInfo>>>();
      // Solana's shared public RPC is rate-limited and can occasionally return
      // null for a very recent account even though the transaction is confirmed.
      // Read in <=100-key batches, then retry missing accounts against fallback
      // RPCs before declaring a bonding curve unavailable.
      const BATCH_SIZE = 100;
      for (let offset = 0; offset < flatAddresses.length; offset += BATCH_SIZE) {
        const batch = flatAddresses.slice(offset, offset + BATCH_SIZE);
        const accounts = await solana.getMultipleAccountsInfo(batch, "confirmed");
        batch.forEach((address, index) => accountByAddress.set(address.toBase58(), accounts[index] ?? null));
      }

      const missingAddresses = flatAddresses.filter((address) => !accountByAddress.get(address.toBase58()));
      if (missingAddresses.length > 0 && solanaFallbacks.length > 0) {
        for (const fallback of solanaFallbacks) {
          if (missingAddresses.length === 0) break;
          try {
            for (let offset = 0; offset < missingAddresses.length; offset += BATCH_SIZE) {
              const batch = missingAddresses.slice(offset, offset + BATCH_SIZE);
              const accounts = await fallback.connection.getMultipleAccountsInfo(batch, "confirmed");
              batch.forEach((address, index) => {
                const account = accounts[index] ?? null;
                if (account) accountByAddress.set(address.toBase58(), account);
              });
            }
            log.info(
              { provider: fallback.url, recovered: missingAddresses.filter((address) => accountByAddress.get(address.toBase58())).length },
              "Pump.fun fallback RPC account recovery attempted",
            );
          } catch (err) {
            log.warn({ err, provider: fallback.url }, "Pump.fun fallback RPC failed");
          }
        }
      }

      candidates.forEach(({ opportunity, addresses }) => {
        let selected: PumpCurveState | null = null;
        let selectedAddress: string | undefined;
        for (const address of addresses) {
          const account = accountByAddress.get(address);
          const parsed = parsePumpCurveAccount(account);
          if (parsed) {
            selected = parsed;
            selectedAddress = address;
            break;
          }
        }
        const anyAccount = addresses.map((address) => accountByAddress.get(address)).find(Boolean);
        if (anyAccount) curveAccountsFound += 1;
        if (selected) curveAccountsParsed += 1;
        curveByToken.set(opportunity.tokenAddress, selected);
        if (selectedAddress) curveAddressByToken.set(opportunity.tokenAddress, selectedAddress);

        if (anyAccount && !selected) {
          log.warn({
            tokenAddress: opportunity.tokenAddress,
            candidateCurveAddresses: addresses,
            dataLength: anyAccount.data.length,
            owner: anyAccount.owner.toBase58(),
          }, "Pump.fun bonding curve candidates found but none parsed");
        }
      });
    } catch (err) {
      log.warn({ err, opportunities: opportunities.length }, "Failed to batch-read Pump.fun bonding curves");
    }

    let skippedNoPairAddress = 0;
    let refreshed = 0;
    let onChainOnly = 0;
    let dexEnriched = 0;
    let failures = 0;
    let dexAttempts = 0;

    await Promise.allSettled(opportunities.map(async (opportunity) => {
      if (!opportunity.pairAddress) {
        skippedNoPairAddress += 1;
        return;
      }
      if (running.has(opportunity.id)) return;
      running.add(opportunity.id);
      try {
        const previous = await db.researchObservation.findFirst({
          where: { opportunityId: opportunity.id, priceUsd: { not: null } },
          orderBy: { observedAt: "desc" },
          select: { priceUsd: true, liquidityUsd: true, observedAt: true },
        });

        const curve = curveByToken.get(opportunity.tokenAddress) ?? null;
        const curveAddress = curveAddressByToken.get(opportunity.tokenAddress);
        let observation = curve
          ? buildPumpObservation(opportunity.tokenAddress, curve, solPriceUsd, previous ?? undefined)
          : null;
        if (observation && curveAddress) observation.pairAddress = curveAddress;

        if (observation) {
          const lastDexAt = dexLastEnrichment.get(opportunity.id) ?? 0;
          if (dexAttempts < maxDexEnrichmentsPerTick && Date.now() - lastDexAt >= DEX_ENRICHMENT_TTL_MS) {
            dexAttempts += 1;
            dexLastEnrichment.set(opportunity.id, Date.now());
            const dexPair = await fetchDexPair(opportunity.tokenAddress);
            if (dexPair) {
              observation = mergeDexEnrichment(observation, dexPair);
              dexEnriched += 1;
            }
          }

          observation = await enrichSolanaSecurity(observation);
          await recordMarketObservation(opportunity.id, observation);
          refreshed += 1;
          if (!observation.volumeUsd && !observation.buyCount && !observation.sellCount) onChainOnly += 1;
          return;
        }

        // If the bonding curve has graduated/migrated, DEX Screener can still
        // provide the secondary post-migration pool snapshot. This is deliberately
        // limited and never blocks the on-chain path above.
        const lastDexAt = dexLastEnrichment.get(opportunity.id) ?? 0;
        if (dexAttempts < maxDexEnrichmentsPerTick && Date.now() - lastDexAt >= DEX_ENRICHMENT_TTL_MS) {
          dexAttempts += 1;
          dexLastEnrichment.set(opportunity.id, Date.now());
          const dexPair = await fetchDexPair(opportunity.tokenAddress);
          if (dexPair) {
            const previousObservation = await db.researchObservation.findFirst({
              where: { opportunityId: opportunity.id, priceUsd: { not: null } },
              orderBy: { observedAt: "desc" },
              select: { priceUsd: true, liquidityUsd: true, observedAt: true },
            });
            const priceUsd = finite(Number(dexPair.priceUsd));
            if (priceUsd !== undefined) {
              const base: MarketObservation = {
                chain: "solana",
                tokenAddress: opportunity.tokenAddress,
                pairAddress: dexPair.pairAddress,
                dex: dexPair.dexId,
                observedAt: Date.now(),
                launchTime: dexPair.pairCreatedAt ?? undefined,
                priceUsd,
              };
              const enriched = mergeDexEnrichment(base, dexPair);
              const previousPrice = previousObservation?.priceUsd ?? undefined;
              enriched.priceVelocityPct = previousPrice && previousPrice > 0
                ? ((priceUsd / previousPrice) - 1) * 100
                : undefined;
              const secured = await enrichSolanaSecurity(enriched);
              await recordMarketObservation(opportunity.id, secured);
              refreshed += 1;
              dexEnriched += 1;
              return;
            }
          }
        }

        onChainOnly += 1;
      } catch (err) {
        failures += 1;
        log.warn({ err, opportunityId: opportunity.id, tokenAddress: opportunity.tokenAddress }, "Failed to refresh Solana market data");
      } finally {
        running.delete(opportunity.id);
      }
    }));

    log.info({
      opportunities: opportunities.length,
      curveAccountsRead: curveByToken.size,
      curveAccountsFound,
      curveAccountsParsed,
      refreshed,
      onChainOnly,
      dexEnriched,
      dexAttempts,
      skippedNoPairAddress,
      failures,
    }, "Solana market-data tick");
  };

  const onPair = (_pair: NewPairEvent) => { void tick(); };
  const unsubscribe = eventBus.on("sniper.newPair", onPair);
  void tick();
  timer = setInterval(() => void tick(), intervalMs);
  log.info({ intervalMs, maxPairsPerTick, maxDexEnrichmentsPerTick }, "Solana market-data collector started");
  return () => { stopped = true; unsubscribe(); if (timer) clearInterval(timer); };
}
