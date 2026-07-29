import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Quote, TxResult } from "@clawd/core";
import { evmConfig, type EvmChain } from "./config.js";
import { ROUTER_V2_ABI, ERC20_ABI, NATIVE_TOKEN_ADDRESS } from "./abis.js";
import { getSubmitTransport } from "./submit-client.js";

function requireRouter(chain: EvmChain) {
  const cfg = evmConfig(chain);
  if (!cfg.routerAddress || !cfg.wrappedNativeAddress) {
    throw new Error(
      `No Uniswap-V2-style router configured for ${chain} (network-specific — see packages/chains/src/evm/config.ts).`,
    );
  }
  return { cfg, router: cfg.routerAddress, wrappedNative: cfg.wrappedNativeAddress };
}

function buildPath(
  tokenIn: string,
  tokenOut: string,
  wrappedNative: `0x${string}`,
): `0x${string}`[] {
  const inAddr = tokenIn === NATIVE_TOKEN_ADDRESS ? wrappedNative : (tokenIn as `0x${string}`);
  const outAddr = tokenOut === NATIVE_TOKEN_ADDRESS ? wrappedNative : (tokenOut as `0x${string}`);
  // Direct pair only — multi-hop routing through intermediate pools is a follow-up.
  return [inAddr, outAddr];
}

export async function getUniswapV2Quote(
  chain: EvmChain,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
): Promise<Quote> {
  const { cfg, router, wrappedNative } = requireRouter(chain);
  const client = createPublicClient({ chain: cfg.viemChain, transport: http(cfg.rpcUrl) });
  const path = buildPath(tokenIn, tokenOut, wrappedNative);

  const amounts = (await client.readContract({
    address: router,
    abi: ROUTER_V2_ABI,
    functionName: "getAmountsOut",
    args: [amountIn, path],
  })) as bigint[];
  const amountOut = amounts[amounts.length - 1] ?? 0n;

  return {
    chain,
    tokenIn,
    tokenOut,
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    // V2's constant-product formula makes price impact derivable from reserves;
    // left at 0 for now (Guard's liquidity check covers the same risk from another angle).
    priceImpactPct: 0,
    route: "uniswap-v2",
    raw: { path },
  };
}

async function ensureAllowance(
  publicClient: PublicClient,
  walletClient: WalletClient,
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
  account: Account,
) {
  const current = (await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, spender],
  })) as bigint;
  if (current >= amount) return;

  const hash = await walletClient.writeContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
    account,
    chain: walletClient.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

export async function executeUniswapV2Swap(
  chain: EvmChain,
  rawPrivateKeyHex: string,
  quote: Quote,
): Promise<TxResult> {
  const { cfg, router } = requireRouter(chain);
  const account = privateKeyToAccount(rawPrivateKeyHex as `0x${string}`);
  const publicClient = createPublicClient({ chain: cfg.viemChain, transport: http(cfg.rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain: cfg.viemChain,
    transport: getSubmitTransport(chain),
  });

  const path = (quote.raw as { path: `0x${string}`[] }).path;
  const amountIn = BigInt(quote.amountIn);
  const amountOutMin = (BigInt(quote.amountOut) * 95n) / 100n; // 5% slippage tolerance
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 5 * 60);

  const buyingWithNative = quote.tokenIn === NATIVE_TOKEN_ADDRESS;
  const sellingToNative = quote.tokenOut === NATIVE_TOKEN_ADDRESS;

  let txHash: `0x${string}`;
  if (buyingWithNative) {
    txHash = await walletClient.writeContract({
      address: router,
      abi: ROUTER_V2_ABI,
      functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
      args: [amountOutMin, path, account.address, deadline],
      value: amountIn,
      account,
      chain: cfg.viemChain,
    });
  } else if (sellingToNative) {
    await ensureAllowance(publicClient, walletClient, path[0]!, router, amountIn, account);
    txHash = await walletClient.writeContract({
      address: router,
      abi: ROUTER_V2_ABI,
      functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
      args: [amountIn, amountOutMin, path, account.address, deadline],
      account,
      chain: cfg.viemChain,
    });
  } else {
    await ensureAllowance(publicClient, walletClient, path[0]!, router, amountIn, account);
    txHash = await walletClient.writeContract({
      address: router,
      abi: ROUTER_V2_ABI,
      functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens",
      args: [amountIn, amountOutMin, path, account.address, deadline],
      account,
      chain: cfg.viemChain,
    });
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const amountInNum = Number(quote.amountIn);
  const amountOutNum = Number(quote.amountOut);

  return {
    chain,
    txHash,
    status: receipt.status === "success" ? "confirmed" : "failed",
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    price: amountInNum > 0 ? amountOutNum / amountInNum : 0,
  };
}
