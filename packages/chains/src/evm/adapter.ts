import { createPublicClient, http } from "viem";
import { networkForChain, createLogger } from "@clawd/core";
import { withDecryptedKey } from "@clawd/wallet";
import type { ChainAdapter, Unsubscribe } from "../types.js";
import { evmConfig, type EvmChain } from "./config.js";
import { watchEvmNewPairs, watchEvmWallet } from "./watch.js";
import { getUniswapV2Quote, executeUniswapV2Swap } from "./uniswap-v2.js";
import { getOneInchQuote, executeOneInchSwap } from "./oneinch.js";
import { withdrawNative } from "./transfer.js";

const log = createLogger("chains:evm:adapter");

export function createEvmAdapter(chain: EvmChain): ChainAdapter {
  const cfg = evmConfig(chain);
  const client = createPublicClient({ chain: cfg.viemChain, transport: http(cfg.rpcUrl) });

  return {
    chain,
    network: networkForChain(chain),
    enabled: true,

    async getBalance(address) {
      return client.getBalance({ address: address as `0x${string}` });
    },

    watchNewPairs(onEvent): Unsubscribe {
      return watchEvmNewPairs(chain, onEvent);
    },

    watchWallet(address, onEvent): Unsubscribe {
      return watchEvmWallet(chain, address, onEvent);
    },

    async getQuote(tokenIn, tokenOut, amountIn) {
      // 1inch aggregates across every DEX on the chain — genuinely "best
      // fill," unlike the direct V2 router below — but only exists on
      // mainnet with an API key configured. Falls back to the V2 router
      // (works everywhere, including testnets) otherwise.
      const oneInch = await getOneInchQuote(chain, tokenIn, tokenOut, amountIn);
      if (oneInch) return oneInch;
      return getUniswapV2Quote(chain, tokenIn, tokenOut, amountIn);
    },

    async executeSwap(encryptedKey, quote) {
      return withDecryptedKey(encryptedKey, async (rawKey) => {
        if (quote.route === "1inch") {
          const result = await executeOneInchSwap(chain, rawKey, quote);
          if (result) return result;
          log.warn({ chain }, "1inch execution failed — falling back to V2 router with a fresh quote");
          const fallbackQuote = await getUniswapV2Quote(chain, quote.tokenIn, quote.tokenOut, BigInt(quote.amountIn));
          return executeUniswapV2Swap(chain, rawKey, fallbackQuote);
        }
        return executeUniswapV2Swap(chain, rawKey, quote);
      });
    },

    async withdraw(encryptedKey, toAddress, amount) {
      return withDecryptedKey(encryptedKey, (rawKey) =>
        withdrawNative(chain, rawKey, toAddress, amount),
      );
    },
  };
}
