import { getDb } from "@clawd/db";
import { getChainAdapter, formatNativeAmount } from "@clawd/chains";
import { getPythPrice, nativeAssetPythSymbol, type NativeAssetSymbol } from "@clawd/pricing";
import type { Chain } from "@clawd/core";

const BALANCE_FETCH_TIMEOUT_MS = 4000;
const PRICE_CACHE_TTL_MS = 30_000;
const BALANCE_CACHE_TTL_MS = 20_000;

/**
 * Process-wide cache, keyed by Pyth symbol rather than chain — ethereum and
 * base both price off ETH/USD, so caching by chain alone still fires the same
 * Hermes request twice on one page load. Caches the in-flight promise (not
 * just the resolved value) so concurrent callers for the same symbol — e.g.
 * a user's ethereum and base wallets, priced in the same Promise.all — coalesce
 * into one request instead of both missing the cache simultaneously. A short
 * TTL means every dashboard page load doesn't re-hit Pyth from scratch either
 * (this is a display estimate, not a settlement price, so a few seconds of
 * staleness is fine).
 */
const priceCache = new Map<NativeAssetSymbol, { promise: Promise<number | null>; expiresAt: number }>();

function getCachedNativeAssetUsdPrice(chain: Chain): Promise<number | null> {
  const symbol = nativeAssetPythSymbol(chain);
  if (!symbol) return Promise.resolve(null);
  const cached = priceCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = getPythPrice(symbol);
  priceCache.set(symbol, { promise, expiresAt: Date.now() + PRICE_CACHE_TTL_MS });
  return promise;
}

/** Races `promise` against a timeout, resolving to `fallback` on either a timeout or a rejection. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]).catch(
    () => fallback,
  );
}

/**
 * Process-wide cache, keyed by (chain, address), promise-coalesced same as
 * priceCache above. This matters more than it looks: viem's http transport
 * retries a failed RPC call up to 3 times with a 10s timeout per attempt
 * (confirmed against the installed package, node_modules/viem's buildRequest.js
 * / transports/http.js) — up to ~30s of real background work our own
 * withTimeout below can't cancel, only stop waiting on (ChainAdapter.getBalance
 * takes no abort signal). On a flaky RPC (observed intermittently against
 * this project's testnet endpoints), every dashboard page load re-firing that
 * for every wallet piles up concurrent zombie retries on a long-lived dev
 * server. Caching means repeat navigation within the TTL reuses the same
 * in-flight/settled call instead of starting a fresh one.
 */
const balanceCache = new Map<string, { promise: Promise<bigint | null>; expiresAt: number }>();

/** Live on-chain balance, raw native units — null (never a fabricated 0) if the RPC call failed/timed out. */
export function getLiveBalance(chain: Chain, address: string): Promise<bigint | null> {
  const key = `${chain}:${address}`;
  const cached = balanceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = withTimeout(getChainAdapter(chain).getBalance(address), BALANCE_FETCH_TIMEOUT_MS, null);
  balanceCache.set(key, { promise, expiresAt: Date.now() + BALANCE_CACHE_TTL_MS });
  return promise;
}

/**
 * Best-effort USD value of a raw native-unit amount, via Pyth. Display estimate
 * only (dashboard summaries) — never fed into trading math, which stays in raw
 * bigint units per computeFeeRaw's precision reasoning.
 */
export async function getUsdValue(chain: Chain, raw: bigint): Promise<number | null> {
  const price = await getCachedNativeAssetUsdPrice(chain);
  return price === null ? null : Number(formatNativeAmount(chain, raw)) * price;
}

export function formatUsd(value: number | null): string {
  if (value === null) return "unavailable";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export interface ChainBalanceSummary {
  chain: Chain;
  walletCount: number;
  unavailableCount: number;
  totalRaw: bigint;
  usdPrice: number | null;
  usdValue: number | null;
}

export interface CumulativeBalances {
  byChain: ChainBalanceSummary[];
  /** Sum of every priced chain's usdValue — null only if no chain had a live price at all. */
  totalUsd: number | null;
}

/**
 * Platform-wide live balance across every user's wallet (every row, not just
 * deployed ones — a paused wallet can still hold funds), summed per chain
 * since native units don't combine across chains (same reasoning as
 * performance.ts's per-chain reports), then normalized to USD via Pyth so
 * operators get one genuinely cumulative figure. Chains with no listed Pyth
 * feed (Monad, Robinhood Chain — see native-price.ts's nativeAssetPythSymbol)
 * still contribute their native total but are excluded from the USD sum
 * rather than counted as $0.
 */
export async function getCumulativeWalletBalances(): Promise<CumulativeBalances> {
  const db = getDb();
  const wallets = await db.wallet.findMany({ select: { chain: true, address: true } });

  const [balances, priceEntries] = await Promise.all([
    Promise.all(wallets.map(async (w) => ({ chain: w.chain as Chain, raw: await getLiveBalance(w.chain, w.address) }))),
    Promise.all(
      Array.from(new Set(wallets.map((w) => w.chain as Chain))).map(
        async (chain) => [chain, await getCachedNativeAssetUsdPrice(chain)] as const,
      ),
    ),
  ]);
  const prices = new Map(priceEntries);

  const byChain: ChainBalanceSummary[] = Array.from(prices.keys()).map((chain) => {
    const rows = balances.filter((b) => b.chain === chain);
    const totalRaw = rows.reduce((sum, r) => sum + (r.raw ?? 0n), 0n);
    const usdPrice = prices.get(chain) ?? null;
    const usdValue = usdPrice !== null ? Number(formatNativeAmount(chain, totalRaw)) * usdPrice : null;
    return {
      chain,
      walletCount: rows.length,
      unavailableCount: rows.filter((r) => r.raw === null).length,
      totalRaw,
      usdPrice,
      usdValue,
    };
  });

  const pricedChains = byChain.filter((c) => c.usdValue !== null);
  const totalUsd = pricedChains.length > 0 ? pricedChains.reduce((sum, c) => sum + (c.usdValue ?? 0), 0) : null;

  return { byChain, totalUsd };
}
