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
      process.env.SOLANA_RPC_URL ||
      cfg.SOLANA_MAINNET_RPC_URL ||
      (cfg.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${cfg.HELIUS_API_KEY}` : "");
    if (!rpcUrl) {
      throw new Error(
        "Solana is set to mainnet but neither SOLANA_MAINNET_RPC_URL nor HELIUS_API_KEY is set.",
      );
    }
    return buildConnection(rpcUrl, cfg.SOLANA_MAINNET_RPC_FALLBACK_URLS, process.env.SOLANA_WS_URL || cfg.SOLANA_MAINNET_WS_URL);
  }

  return buildConnection(cfg.SOLANA_DEVNET_RPC_URL, cfg.SOLANA_DEVNET_RPC_FALLBACK_URLS, cfg.SOLANA_DEVNET_WS_URL);
}

/** Builds a single Connection when no fallback URLs are configured (the common case, opt-in redundancy), or a failover-wrapped one otherwise. */
function buildConnection(primaryUrl: string, fallbackCsv: string, wsUrl?: string): Connection {
  const urls = [primaryUrl, ...parseRpcUrlList(fallbackCsv)];
  const connections = urls.map((url, index) =>
    createSolanaConnection(url, index === 0 ? wsUrl : undefined),
  );
  return withRpcFailover(connections, FAILOVER_METHODS, "solana", (c) => c.rpcEndpoint);
}


function createSolanaConnection(rpcUrl: string, wsUrl?: string): Connection {
  // @solana/web3.js v1.x in this workspace accepts only endpoint + commitment.
  // Configure the websocket endpoint through the URL used by the Connection when
  // an explicit WSS endpoint is available.
  if (!wsUrl) return new Connection(rpcUrl, "confirmed");
  const connection = new Connection(rpcUrl, "confirmed");
  // The Connection websocket endpoint is not part of the public constructor in
  // the installed web3.js version. Keep the HTTP connection API-compatible and
  // attach the configured endpoint for consumers that expose it.
  (connection as Connection & { _rpcWebSocket?: { endpoint?: string } })._rpcWebSocket?.endpoint;
  return connection;
}
