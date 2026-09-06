import { Connection } from "@solana/web3.js";
import { loadConfig, networkForChain } from "@clawd/core";
import { parseRpcUrlList, withRpcFailover } from "../rpc-failover.js";

/**
 * One-shot request methods safe to retry against a fallback endpoint on
 * failure. Subscription methods (onLogs, removeOnLogsListener,
 * onAccountChange, ...) are deliberately excluded — a live subscription is
 * bound to one connection's websocket and returns a subscription id
 * synchronously, not a promise; it isn't a retryable one-shot call.
 */
const FAILOVER_METHODS = [
  "getBalance",
  "getLatestBlockhash",
  "getParsedTransaction",
  "getTransaction",
  "sendRawTransaction",
  "confirmTransaction",
] as const satisfies readonly (keyof Connection)[];

export function getSolanaConnection(): Connection {
  const cfg = loadConfig();
  const network = networkForChain("solana");

  if (network === "mainnet") {
    const rpcUrl =
      cfg.SOLANA_MAINNET_RPC_URL ||
      (cfg.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${cfg.HELIUS_API_KEY}` : "");
    if (!rpcUrl) {
      throw new Error(
        "Solana is set to mainnet but neither SOLANA_MAINNET_RPC_URL nor HELIUS_API_KEY is set.",
      );
    }
    return buildConnection(rpcUrl, cfg.SOLANA_MAINNET_RPC_FALLBACK_URLS);
  }

  return buildConnection(cfg.SOLANA_DEVNET_RPC_URL, cfg.SOLANA_DEVNET_RPC_FALLBACK_URLS);
}

/** Builds a single Connection when no fallback URLs are configured (the common case, opt-in redundancy), or a failover-wrapped one otherwise. */
function buildConnection(primaryUrl: string, fallbackCsv: string): Connection {
  const urls = [primaryUrl, ...parseRpcUrlList(fallbackCsv)];
  const connections = urls.map((url) => new Connection(url, "confirmed"));
  return withRpcFailover(connections, FAILOVER_METHODS, "solana", (c) => c.rpcEndpoint);
}
