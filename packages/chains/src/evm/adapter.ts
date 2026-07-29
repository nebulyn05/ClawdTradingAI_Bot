import { createPublicClient, http } from "viem";
import { networkForChain } from "@clawd/core";
import { withDecryptedKey } from "@clawd/wallet";
import type { ChainAdapter, Unsubscribe } from "../types.js";
import { evmConfig, type EvmChain } from "./config.js";
import { watchEvmNewPairs, watchEvmWallet } from "./watch.js";
import { getUniswapV2Quote, executeUniswapV2Swap } from "./uniswap-v2.js";
import { withdrawNative } from "./transfer.js";

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

    getQuote(tokenIn, tokenOut, amountIn) {
      return getUniswapV2Quote(chain, tokenIn, tokenOut, amountIn);
    },

    async executeSwap(encryptedKey, quote) {
      return withDecryptedKey(encryptedKey, (rawKey) => executeUniswapV2Swap(chain, rawKey, quote));
    },

    async withdraw(encryptedKey, toAddress, amount) {
      return withDecryptedKey(encryptedKey, (rawKey) =>
        withdrawNative(chain, rawKey, toAddress, amount),
      );
    },
  };
}
