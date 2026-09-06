import { fallback, http, type Transport } from "viem";
import { createLogger } from "@clawd/core";
import { evmConfig, type EvmChain } from "./config.js";

const log = createLogger("chains:evm:rpc");

/**
 * Builds a viem transport for `chain` that tries the configured primary RPC
 * URL first, then each configured fallback URL (evmConfig's
 * fallbackRpcUrls) in order, on any request failure — via viem's own
 * `fallback` transport rather than a hand-rolled retry loop (Solana has no
 * such built-in, hence rpc-failover.ts's Proxy-based equivalent for that
 * side). Every individual HTTP attempt/response is logged so a degraded
 * primary shows up in logs instead of being silently masked by a healthy
 * fallback. Falls back to a single plain `http` transport when no fallback
 * URLs are configured — this is opt-in redundancy, same as Flashbots/Jito
 * elsewhere in this package.
 */
export function createEvmTransport(chain: EvmChain): Transport {
  const cfg = evmConfig(chain);
  const urls = [cfg.rpcUrl, ...cfg.fallbackRpcUrls].filter(Boolean);

  if (urls.length <= 1) return http(cfg.rpcUrl);
  return fallback(urls.map((url) => loggingHttp(chain, url)));
}

function loggingHttp(chain: EvmChain, url: string) {
  return http(url, {
    // A single retry against the same URL before viem's fallback transport
    // moves on to the next one — enough to absorb a one-off blip without
    // spending several retries on a genuinely dead primary first.
    retryCount: 1,
    onFetchRequest: () => {
      log.debug({ chain, url }, "RPC request attempt");
    },
    onFetchResponse: (response) => {
      if (!response.ok) {
        log.warn({ chain, url, status: response.status }, "RPC provider returned a non-OK response");
      }
    },
  });
}
