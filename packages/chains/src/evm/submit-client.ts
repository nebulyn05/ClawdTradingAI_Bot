import { http, type Transport } from "viem";
import { loadConfig, networkForChain, getBooleanSetting } from "@clawd/core";
import type { EvmChain } from "./config.js";
import { createEvmTransport } from "./transport.js";

/**
 * Transport used for the SEND step of an EVM transaction (not reads/receipts).
 * On Ethereum mainnet with FLASHBOTS_ENABLED, submits through Flashbots
 * Protect instead of the public mempool — frontrunning/revert protection,
 * opt-in since it only matters where real MEV risk exists (a single
 * dedicated relay URL, no failover — redundancy across MEV-protect relays
 * is a different problem than a public RPC outage). Every other
 * chain/network just uses its regular (failover-aware) RPC. The flag is
 * live-toggleable from the admin dashboard (Setting override) — checked on
 * every swap submission, not just once at startup.
 */
export async function getSubmitTransport(chain: EvmChain): Promise<Transport> {
  const cfg = loadConfig();
  const flashbotsEnabled = await getBooleanSetting("FLASHBOTS_ENABLED", cfg.FLASHBOTS_ENABLED);
  if (chain === "ethereum" && networkForChain(chain) === "mainnet" && flashbotsEnabled) {
    return http(cfg.FLASHBOTS_RPC_URL);
  }
  return createEvmTransport(chain);
}
