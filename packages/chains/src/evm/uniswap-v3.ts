import {
  createPublicClient,
  createWalletClient,
  type Account,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, networkForChain, type Quote, type TxResult } from "@clawd/core";
import type { EvmChain } from "./config.js";
import { evmConfig } from "./config.js";
import { createEvmTransport } from "./transport.js";
import { getSubmitTransport } from "./submit-client.js";
import { ERC20_ABI, NATIVE_TOKEN_ADDRESS } from "./abis.js";

const QUOTER_V2_ABI = [
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{
      name: "params",
      type: "tuple",
      components: [
        { name: "tokenIn", type: "address" },
        { name: "tokenOut", type: "address" },
        { name: "amountIn", type: "uint256" },
        { name: "fee", type: "uint24" },
        { name: "sqrtPriceLimitX96", type: "uint160" },
      ],
    }],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const V3_ROUTER_ABI = [
  {
    name: "unwrapWETH9",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "amountMinimum", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [{
      name: "params",
      type: "tuple",
      components: [
        { name: "tokenIn", type: "address" },
        { name: "tokenOut", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "recipient", type: "address" },
        { name: "deadline", type: "uint256" },
        { name: "amountIn", type: "uint256" },
        { name: "amountOutMinimum", type: "uint256" },
        { name: "sqrtPriceLimitX96", type: "uint160" },
      ],
    }],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const WETH_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "wad", type: "uint256" }],
    outputs: [],
  },
] as const;

// Standard Uniswap V3 fee tiers. We probe each tier and use the best live quote.
// Robinhood Chain's documented launch liquidity commonly uses 1% (10000).
const FEE_TIERS = [100, 500, 3000, 10000] as const;

type V3QuoteRaw = {
  fee: number;
  sqrtPriceX96After: string;
};

function requireV3(chain: EvmChain) {
  const cfg = evmConfig(chain);
  if (networkForChain(chain) !== "mainnet") {
    throw new Error(`Uniswap V3 integration for ${chain} is mainnet-only.`);
  }
  if (!cfg.v3QuoterAddress || !cfg.v3RouterAddress || !cfg.wrappedNativeAddress) {
    throw new Error(`No Uniswap V3 deployment configured for ${chain}.`);
  }
  return {
    cfg,
    quoter: cfg.v3QuoterAddress,
    router: cfg.v3RouterAddress,
    wrappedNative: cfg.wrappedNativeAddress,
  };
}

function normalizeToken(address: string, wrappedNative: `0x${string}`): `0x${string}` {
  return (address === NATIVE_TOKEN_ADDRESS ? wrappedNative : address) as `0x${string}`;
}

async function quoteTier(
  client: PublicClient,
  quoter: `0x${string}`,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
  fee: number,
) {
  try {
    const result = await client.simulateContract({
      address: quoter,
      abi: QUOTER_V2_ABI,
      functionName: "quoteExactInputSingle",
      args: [{
        tokenIn,
        tokenOut,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      }],
    });
    const [amountOut, sqrtPriceX96After] = result.result;
    if (amountOut <= 0n) return null;
    return { amountOut, sqrtPriceX96After, fee };
  } catch {
    return null;
  }
}

export async function getUniswapV3Quote(
  chain: EvmChain,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
): Promise<Quote> {
  const { cfg, quoter, wrappedNative } = requireV3(chain);
  const client = createPublicClient({ chain: cfg.viemChain, transport: createEvmTransport(chain) });
  const inToken = normalizeToken(tokenIn, wrappedNative);
  const outToken = normalizeToken(tokenOut, wrappedNative);

  if (inToken.toLowerCase() === outToken.toLowerCase()) {
    throw new Error("Cannot quote a swap where tokenIn equals tokenOut.");
  }

  const quotes = await Promise.all(
    FEE_TIERS.map((fee) => quoteTier(client, quoter, inToken, outToken, amountIn, fee)),
  );
  const best = quotes
    .filter((q): q is NonNullable<typeof q> => q !== null)
    .sort((a, b) => (a.amountOut > b.amountOut ? -1 : a.amountOut < b.amountOut ? 1 : 0))[0];

  if (!best) {
    throw new Error(`No Uniswap V3 pool with liquidity found for ${chain}: ${tokenIn} -> ${tokenOut}`);
  }

  return {
    chain,
    tokenIn,
    tokenOut,
    amountIn: amountIn.toString(),
    amountOut: best.amountOut.toString(),
    priceImpactPct: 0,
    route: "uniswap-v3",
    raw: {
      fee: best.fee,
      sqrtPriceX96After: best.sqrtPriceX96After.toString(),
    } satisfies V3QuoteRaw,
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

export async function executeUniswapV3Swap(
  chain: EvmChain,
  rawPrivateKeyHex: string,
  quote: Quote,
): Promise<TxResult> {
  const { cfg, router, wrappedNative } = requireV3(chain);
  const account = privateKeyToAccount(rawPrivateKeyHex as `0x${string}`);
  const publicClient = createPublicClient({ chain: cfg.viemChain, transport: createEvmTransport(chain) });
  const walletClient = createWalletClient({
    account,
    chain: cfg.viemChain,
    transport: await getSubmitTransport(chain),
  });

  const raw = quote.raw as V3QuoteRaw;
  const tokenIn = normalizeToken(quote.tokenIn, wrappedNative);
  const tokenOut = normalizeToken(quote.tokenOut, wrappedNative);
  const amountIn = BigInt(quote.amountIn);
  const amountOutMin = (BigInt(quote.amountOut) * 95n) / 100n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 5 * 60);

  let actualInput = amountIn;

  // SwapRouter02's V3 exactInputSingle operates on ERC-20s. Wrap/unwrap native
  // ETH explicitly when the quote uses the native sentinel.
  if (quote.tokenIn === NATIVE_TOKEN_ADDRESS) {
    const wrapHash = await walletClient.writeContract({
      address: wrappedNative,
      abi: WETH_ABI,
      functionName: "deposit",
      value: amountIn,
      account,
      chain: cfg.viemChain,
    });
    await publicClient.waitForTransactionReceipt({ hash: wrapHash });
  } else {
    await ensureAllowance(publicClient, walletClient, tokenIn, router, amountIn, account);
  }

  const swapHash = await walletClient.writeContract({
    address: router,
    abi: V3_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [{
      tokenIn,
      tokenOut,
      fee: raw.fee,
      recipient: quote.tokenOut === NATIVE_TOKEN_ADDRESS ? router : account.address,
      deadline,
      amountIn: actualInput,
      amountOutMinimum: amountOutMin,
      sqrtPriceLimitX96: 0n,
    }],
    value: 0n,
    account,
    chain: cfg.viemChain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });

  if (receipt.status !== "success") {
    return {
      chain,
      txHash: swapHash,
      status: "failed",
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      price: Number(quote.amountOut) / Math.max(Number(quote.amountIn), 1),
    };
  }

  if (quote.tokenOut === NATIVE_TOKEN_ADDRESS) {
    // SwapRouter02 receives the WETH output because the swap recipient above
    // was the router. Unwrap the quoted minimum and send native ETH to the
    // wallet. Any excess WETH remains on the router only if the quote changed
    // materially; the minimum protects against a below-quote execution.
    const unwrapHash = await walletClient.writeContract({
      address: router,
      abi: V3_ROUTER_ABI,
      functionName: "unwrapWETH9",
      args: [amountOutMin, account.address],
      account,
      chain: cfg.viemChain,
    });
    await publicClient.waitForTransactionReceipt({ hash: unwrapHash });
  }

  return {
    chain,
    txHash: swapHash,
    status: "confirmed",
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    price: Number(quote.amountOut) / Math.max(Number(quote.amountIn), 1),
  };
}
