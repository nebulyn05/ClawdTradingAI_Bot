import { getQuote } from "@lifi/sdk";
import type { LiFiStep } from "@lifi/types";
import { createLogger, type Chain } from "@clawd/core";
import { getLifiClient, LIFI_CHAIN_IDS } from "./lifi-client.js";

const log = createLogger("arbiter:lifi");

// Used for cost-estimation-only quotes with no specific wallet in context.
const QUOTE_ONLY_ADDRESS = "0x0000000000000000000000000000000000000001";

/**
 * Real LI.FI quote for bridging `amount` of `tokenAddress` from `fromChain`
 * to `toChain`. Returns the all-in cost as a fraction of the input amount
 * (fees + slippage baked into the quoted toAmount), or null if either chain
 * isn't in LI.FI's supported set or the request fails.
 */
export async function getLifiBridgeCostPct(
  fromChain: Chain,
  toChain: Chain,
  tokenAddress: string,
  amount: bigint,
  fromAddress: string = QUOTE_ONLY_ADDRESS,
): Promise<number | null> {
  const fromChainId = LIFI_CHAIN_IDS[fromChain];
  const toChainId = LIFI_CHAIN_IDS[toChain];
  if (!fromChainId || !toChainId) return null;

  try {
    const step = await getQuote(getLifiClient(), {
      fromChain: fromChainId,
      toChain: toChainId,
      fromToken: tokenAddress,
      toToken: tokenAddress,
      fromAmount: amount.toString(),
      fromAddress,
    });
    const fromAmountNum = Number(step.estimate.fromAmount);
    const toAmountNum = Number(step.estimate.toAmount);
    if (!fromAmountNum || !toAmountNum) return null;
    return Math.max(0, (fromAmountNum - toAmountNum) / fromAmountNum);
  } catch (err) {
    log.warn({ err, fromChain, toChain }, "LI.FI quote failed");
    return null;
  }
}

/** Full quote step, for callers that go on to execute it (see execute.ts). */
export async function getLifiStep(
  fromChain: Chain,
  toChain: Chain,
  tokenAddress: string,
  amount: bigint,
  fromAddress: string,
): Promise<LiFiStep | null> {
  const fromChainId = LIFI_CHAIN_IDS[fromChain];
  const toChainId = LIFI_CHAIN_IDS[toChain];
  if (!fromChainId || !toChainId) return null;

  try {
    return await getQuote(getLifiClient(), {
      fromChain: fromChainId,
      toChain: toChainId,
      fromToken: tokenAddress,
      toToken: tokenAddress,
      fromAmount: amount.toString(),
      fromAddress,
    });
  } catch (err) {
    log.warn({ err, fromChain, toChain }, "LI.FI quote failed");
    return null;
  }
}
