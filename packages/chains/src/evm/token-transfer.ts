import { createPublicClient, createWalletClient, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { TxResult } from "@clawd/core";
import { evmConfig, type EvmChain } from "./config.js";
import { createEvmTransport } from "./transport.js";

/** Balance + decimals for an arbitrary ERC20 token — viem's built-in `erc20Abi` covers the standard interface. */
export async function getErc20Balance(
  chain: EvmChain,
  tokenAddress: string,
  walletAddress: string,
): Promise<{ balance: bigint; decimals: number }> {
  const cfg = evmConfig(chain);
  const client = createPublicClient({ chain: cfg.viemChain, transport: createEvmTransport(chain) });
  const [balance, decimals] = await Promise.all([
    client.readContract({
      address: tokenAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress as `0x${string}`],
    }),
    client.readContract({
      address: tokenAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);
  return { balance, decimals };
}

/** Sends `amount` (already in the token's smallest unit) of an ERC20 token to `toAddress`. */
export async function transferErc20(
  chain: EvmChain,
  rawPrivateKeyHex: string,
  tokenAddress: string,
  toAddress: string,
  amount: bigint,
): Promise<TxResult> {
  const cfg = evmConfig(chain);
  const account = privateKeyToAccount(rawPrivateKeyHex as `0x${string}`);
  const publicClient = createPublicClient({ chain: cfg.viemChain, transport: createEvmTransport(chain) });
  const walletClient = createWalletClient({ account, chain: cfg.viemChain, transport: createEvmTransport(chain) });

  const hash = await walletClient.writeContract({
    address: tokenAddress as `0x${string}`,
    abi: erc20Abi,
    functionName: "transfer",
    args: [toAddress as `0x${string}`, amount],
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
