import { loadConfig, networkForChain, createLogger, type Quote, type TxResult } from "@clawd/core";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { EvmChain } from "./config.js";
import { evmConfig } from "./config.js";
import { getSubmitTransport } from "./submit-client.js";

const log = createLogger("chains:evm:oneinch");

/** 1inch's supported chain IDs among ours — mainnet only, and only chains 1inch actually indexes. */
const ONEINCH_CHAIN_IDS: Partial<Record<EvmChain, number>> = {
  ethereum: 1,
  bsc: 56,
  base: 8453,
};

interface OneInchQuoteResponse {
  dstAmount?: string;
  toAmount?: string; // older API-version field name, kept as a defensive fallback
}

interface OneInchSwapResponse extends OneInchQuoteResponse {
  tx?: { from: string; to: string; data: string; value: string; gas?: number; gasPrice?: string };
}

function apiBase(chainId: number): string {
  return `https://api.1inch.dev/swap/v6.0/${chainId}`;
}

/**
 * Real 1inch v6 aggregator quote — mainnet only (1inch has no meaningful
 * testnet liquidity) and only when ONEINCH_API_KEY is set. Returns null
 * (not a throw) on any of those preconditions, or on request failure, so
 * callers can fall back to the direct V2 router.
 */
export async function getOneInchQuote(
  chain: EvmChain,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
): Promise<Quote | null> {
  const cfg = loadConfig();
  if (!cfg.ONEINCH_API_KEY || networkForChain(chain) !== "mainnet") return null;
  const chainId = ONEINCH_CHAIN_IDS[chain];
  if (!chainId) return null;

  try {
    const url =
      `${apiBase(chainId)}/quote?src=${tokenIn}&dst=${tokenOut}` +
      `&amount=${amountIn.toString()}&includeTokensInfo=false&includeProtocols=false`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.ONEINCH_API_KEY}` } });
    if (!res.ok) {
      log.warn({ status: res.status, chain }, "1inch quote request failed — falling back to V2 router");
      return null;
    }
    const data = (await res.json()) as OneInchQuoteResponse;
    const amountOut = data.dstAmount ?? data.toAmount;
    if (!amountOut) return null;

    return {
      chain,
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
      amountOut,
      priceImpactPct: 0,
      route: "1inch",
      raw: { chainId },
    };
  } catch (err) {
    log.warn({ err, chain }, "1inch quote request threw — falling back to V2 router");
    return null;
  }
}

/** Builds, signs, and submits the swap 1inch quoted. Returns null on any failure to build the tx. */
export async function executeOneInchSwap(
  chain: EvmChain,
  rawPrivateKeyHex: string,
  quote: Quote,
): Promise<TxResult | null> {
  const cfg = loadConfig();
  const chainId = (quote.raw as { chainId: number } | undefined)?.chainId;
  if (!cfg.ONEINCH_API_KEY || !chainId) return null;

  const evm = evmConfig(chain);
  const account = privateKeyToAccount(rawPrivateKeyHex as `0x${string}`);

  try {
    const url =
      `${apiBase(chainId)}/swap?src=${quote.tokenIn}&dst=${quote.tokenOut}` +
      `&amount=${quote.amountIn}&from=${account.address}&slippage=1&disableEstimate=true`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.ONEINCH_API_KEY}` } });
    if (!res.ok) {
      log.warn({ status: res.status, chain }, "1inch swap-build request failed");
      return null;
    }
    const data = (await res.json()) as OneInchSwapResponse;
    if (!data.tx) return null;

    const publicClient = createPublicClient({ chain: evm.viemChain, transport: http(evm.rpcUrl) });
    const walletClient = createWalletClient({
      account,
      chain: evm.viemChain,
      transport: getSubmitTransport(chain),
    });

    const hash = await walletClient.sendTransaction({
      to: data.tx.to as `0x${string}`,
      data: data.tx.data as `0x${string}`,
      value: BigInt(data.tx.value ?? "0"),
      account,
      chain: evm.viemChain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const amountOut = data.dstAmount ?? data.toAmount ?? quote.amountOut;
    const amountInNum = Number(quote.amountIn);
    const amountOutNum = Number(amountOut);

    return {
      chain,
      txHash: hash,
      status: receipt.status === "success" ? "confirmed" : "failed",
      amountIn: quote.amountIn,
      amountOut,
      price: amountInNum > 0 ? amountOutNum / amountInNum : 0,
    };
  } catch (err) {
    log.warn({ err, chain }, "1inch swap execution failed");
    return null;
  }
}

