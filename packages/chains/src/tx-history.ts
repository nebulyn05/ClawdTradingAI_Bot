import { PublicKey } from "@solana/web3.js";
import { loadConfig, type Chain } from "@clawd/core";
import { getSolanaConnection } from "./solana/rpc.js";
import { evmConfig, isEvmChain, type EvmChain } from "./evm/config.js";

const FETCH_TIMEOUT_MS = 5000;
const RESULT_CACHE_TTL_MS = 20_000;
const ETHERSCAN_API_BASE = "https://api.etherscan.io/v2/api";

export interface TxHistoryEntry {
  hash: string;
  timestamp: Date | null;
  direction: "in" | "out" | "self" | "unknown";
  /** Raw native-unit amount moved (lamports/wei), always non-negative regardless of direction. */
  valueRaw: bigint;
  success: boolean;
}

export interface TxHistoryResult {
  entries: TxHistoryEntry[];
  /**
   * "ok" — entries reflect a real (possibly empty) live lookup.
   * "unavailable" — a data source exists for this chain but the live call failed/timed out.
   * "unsupported" — no transaction-history source is wired up for this chain at all
   * (Monad/Robinhood have no known Etherscan-compatible explorer; EVM chains report this
   * too when ETHERSCAN_API_KEY isn't configured) — never silently shown as an empty "ok".
   */
  status: "ok" | "unavailable" | "unsupported";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]).catch(() => null);
}

const resultCache = new Map<string, { promise: Promise<TxHistoryResult>; expiresAt: number }>();

/**
 * Recent native-currency transaction history for `address` on `chain` — a
 * display-only, best-effort feature for the admin dashboard's user profile
 * page (our own DB only ever records trades the bot itself executed; this is
 * the actual on-chain activity, including deposits/withdrawals/manual
 * transfers our DB never sees). Solana uses live RPC directly; EVM chains go
 * through Etherscan's V2 multichain API since there's no equivalent
 * "list transactions for address" JSON-RPC method. This environment had no
 * outbound network access to verify the Etherscan V2 response shape live —
 * built directly from its documented `chainid`-parameterized `account.txlist`
 * contract, but worth a real end-to-end check against a funded testnet
 * wallet once ETHERSCAN_API_KEY is set somewhere with network access.
 *
 * Cached (promise-coalesced, same pattern as @clawd/pricing's price cache) by
 * (chain, address, limit) — every caller during the TTL window, including
 * concurrent ones, shares one lookup rather than each re-running live RPC/API
 * calls. Matters more than it looks: a flaky RPC leaves retries running in
 * the background well past our own FETCH_TIMEOUT_MS (nothing here can cancel
 * an in-flight call), so without this, every repeat page load piles more
 * concurrent background work onto an already-degraded connection.
 */
export function getRecentTransactions(chain: Chain, address: string, limit = 10): Promise<TxHistoryResult> {
  const key = `${chain}:${address}:${limit}`;
  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = fetchRecentTransactions(chain, address, limit);
  resultCache.set(key, { promise, expiresAt: Date.now() + RESULT_CACHE_TTL_MS });
  return promise;
}

async function fetchRecentTransactions(chain: Chain, address: string, limit: number): Promise<TxHistoryResult> {
  if (chain === "solana") return getSolanaTxHistory(address, limit);
  if (isEvmChain(chain)) return getEvmTxHistory(chain, address, limit);
  return { entries: [], status: "unsupported" };
}

async function getSolanaTxHistory(address: string, limit: number): Promise<TxHistoryResult> {
  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(address);
  } catch {
    return { entries: [], status: "unavailable" };
  }

  const result = await withTimeout(fetchSolanaHistory(pubkey, limit), FETCH_TIMEOUT_MS);
  return result ?? { entries: [], status: "unavailable" };
}

async function fetchSolanaHistory(pubkey: PublicKey, limit: number): Promise<TxHistoryResult> {
  const connection = getSolanaConnection();
  const signatures = await connection.getSignaturesForAddress(pubkey, { limit });

  const entries = await Promise.all(
    signatures.map(async (sig): Promise<TxHistoryEntry> => {
      const tx = await connection
        .getParsedTransaction(sig.signature, { maxSupportedTransactionVersion: 0 })
        .catch(() => null);
      const idx = tx?.transaction.message.accountKeys.findIndex((k) => k.pubkey.equals(pubkey)) ?? -1;
      const pre = idx >= 0 ? tx?.meta?.preBalances[idx] : undefined;
      const post = idx >= 0 ? tx?.meta?.postBalances[idx] : undefined;
      const delta = pre !== undefined && post !== undefined ? BigInt(post) - BigInt(pre) : 0n;
      return {
        hash: sig.signature,
        timestamp: sig.blockTime ? new Date(sig.blockTime * 1000) : null,
        direction: delta > 0n ? "in" : delta < 0n ? "out" : "unknown",
        valueRaw: delta < 0n ? -delta : delta,
        success: sig.err === null,
      };
    }),
  );

  return { entries, status: "ok" };
}

interface EtherscanTxListEntry {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  isError: string;
}

interface EtherscanTxListResponse {
  status: string;
  result: EtherscanTxListEntry[] | string;
}

async function getEvmTxHistory(chain: EvmChain, address: string, limit: number): Promise<TxHistoryResult> {
  if (chain === "monad" || chain === "robinhood") return { entries: [], status: "unsupported" };

  const cfg = loadConfig();
  if (!cfg.ETHERSCAN_API_KEY) return { entries: [], status: "unsupported" };

  const chainId = evmConfig(chain).viemChain.id;
  const url =
    `${ETHERSCAN_API_BASE}?chainid=${chainId}&module=account&action=txlist&address=${address}` +
    `&sort=desc&page=1&offset=${limit}&apikey=${cfg.ETHERSCAN_API_KEY}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { entries: [], status: "unavailable" };
    const data = (await res.json()) as EtherscanTxListResponse;
    if (!Array.isArray(data.result)) return { entries: [], status: "unavailable" };

    const lower = address.toLowerCase();
    const entries: TxHistoryEntry[] = data.result.map((tx) => {
      const from = tx.from.toLowerCase() === lower;
      const to = tx.to.toLowerCase() === lower;
      return {
        hash: tx.hash,
        timestamp: new Date(Number(tx.timeStamp) * 1000),
        direction: from && to ? "self" : from ? "out" : to ? "in" : "unknown",
        valueRaw: BigInt(tx.value),
        success: tx.isError === "0",
      };
    });
    return { entries, status: "ok" };
  } catch {
    return { entries: [], status: "unavailable" };
  }
}
