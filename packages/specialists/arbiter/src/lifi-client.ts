import { createClient, ChainId, type SDKClient } from "@lifi/sdk";
import type { Chain } from "@clawd/core";

let client: SDKClient | undefined;

export function getLifiClient(): SDKClient {
  client ??= createClient({ integrator: "clawd-agents" });
  return client;
}

/**
 * LI.FI chain IDs for our supported chains. Verified directly against the
 * installed @lifi/types package source (ChainId enum) rather than guessed —
 * this session's network access is blocked, so live docs weren't an option,
 * but the installed package's own compiled source is ground truth. Monad and
 * Robinhood Chain aren't in LI.FI's chain list yet (too new/niche).
 */
export const LIFI_CHAIN_IDS: Partial<Record<Chain, number>> = {
  solana: ChainId.SOL,
  ethereum: ChainId.ETH,
  bsc: ChainId.BSC,
  base: ChainId.BAS,
};
