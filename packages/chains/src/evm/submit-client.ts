import { http, type Transport } from "viem";
import { loadConfig, networkForChain } from "@clawd/core";
import { evmConfig, type EvmChain } from "./config.js";

/**
 * Transport used for the SEND step of an EVM transaction (not reads/receipts).
 * On Ethereum mainnet with FLASHBOTS_ENABLED, submits through Flashbots
 * Protect instead of the public mempool — frontrunning/revert protection,
 * opt-in since it only matters where real MEV risk exists. Every other
 * chain/network just uses its regular RPC.
 */
export function getSubmitTransport(chain: EvmChain): Transport {
  const cfg = loadConfig();
  if (chain === "ethereum" && networkForChain(chain) === "mainnet" && cfg.FLASHBOTS_ENABLED) {
    return http(cfg.FLASHBOTS_RPC_URL);
  }
  return http(evmConfig(chain).rpcUrl);
}
