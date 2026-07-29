import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { TxResult } from "@clawd/core";
import { evmConfig, type EvmChain } from "./config.js";

/** Sends `amount` wei of the chain's native token from the given key to `toAddress`. */
export async function withdrawNative(
  chain: EvmChain,
  rawPrivateKeyHex: string,
  toAddress: string,
  amount: bigint,
): Promise<TxResult> {
  const cfg = evmConfig(chain);
  const account = privateKeyToAccount(rawPrivateKeyHex as `0x${string}`);
  const publicClient = createPublicClient({ chain: cfg.viemChain, transport: http(cfg.rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain: cfg.viemChain,
    transport: http(cfg.rpcUrl),
  });

  const hash = await walletClient.sendTransaction({
    to: toAddress as `0x${string}`,
    value: amount,
    account,
    chain: cfg.viemChain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return {
    chain,
    txHash: hash,
    status: receipt.status === "success" ? "confirmed" : "failed",
    amountIn: amount.toString(),
    amountOut: amount.toString(),
    price: 1,
  };
}
