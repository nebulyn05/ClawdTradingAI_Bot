import { Connection, PublicKey } from "@solana/web3.js";
import { networkForChain, type Chain } from "@clawd/core";
import { withDecryptedKey } from "@clawd/wallet";
import type { ChainAdapter, Unsubscribe } from "../types.js";
import { getSolanaConnection } from "./rpc.js";
import { watchPumpFunLaunches } from "./pumpfun.js";
import { watchSolanaWallet } from "./watch-wallet.js";
import { getJupiterQuote, executeJupiterSwap } from "./jupiter.js";
import { withdrawSol } from "./transfer.js";

export function createSolanaAdapter(): ChainAdapter {
  const chain: Chain = "solana";
  let connection: Connection | undefined;
  const conn = () => (connection ??= getSolanaConnection());

  return {
    chain,
    network: networkForChain(chain),
    enabled: true,

    async getBalance(address) {
      const lamports = await conn().getBalance(new PublicKey(address));
      return BigInt(lamports);
    },

    watchNewPairs(onEvent): Unsubscribe {
      return watchPumpFunLaunches(conn(), onEvent);
    },

    watchWallet(address, onEvent): Unsubscribe {
      return watchSolanaWallet(conn(), chain, address, onEvent);
    },

    getQuote(tokenIn, tokenOut, amountIn) {
      return getJupiterQuote(tokenIn, tokenOut, amountIn);
    },

    async executeSwap(encryptedKey, quote) {
      return withDecryptedKey(encryptedKey, (rawKey) => executeJupiterSwap(conn(), rawKey, quote));
    },

    async withdraw(encryptedKey, toAddress, amount) {
      return withDecryptedKey(encryptedKey, (rawKey) =>
        withdrawSol(conn(), rawKey, toAddress, amount),
      );
    },
  };
}
