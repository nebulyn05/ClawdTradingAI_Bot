import { createPublicClient, http, webSocket, type Log } from "viem";
import type { NewPairEvent, WalletActivity } from "@clawd/core";
import { createLogger } from "@clawd/core";
import { evmConfig, type EvmChain, type EvmChainConfig } from "./config.js";
import { FACTORY_V2_ABI, ERC20_ABI, NATIVE_TOKEN_ADDRESS } from "./abis.js";
import type { Unsubscribe } from "../types.js";

const log = createLogger("chains:evm:watch");

const DEX_LABELS: Record<EvmChain, string> = {
  ethereum: "uniswap-v2",
  bsc: "pancakeswap-v2",
  base: "v2-fork",
  monad: "v2-fork",
  robinhood: "v2-fork",
};

/**
 * Live subscriptions (new pairs, wallet activity) use a websocket transport
 * when one's configured — real push notifications instead of the http
 * polling viem falls back to. One-off calls (quotes, balances, sends) stay
 * on http in the other EVM modules since a persistent socket doesn't help there.
 */
function watchClient(cfg: EvmChainConfig) {
  return createPublicClient({
    chain: cfg.viemChain,
    transport: cfg.wsUrl ? webSocket(cfg.wsUrl) : http(cfg.rpcUrl),
  });
}

/** Watches a Uniswap-V2-style factory for new pairs against the chain's wrapped native token. */
export function watchEvmNewPairs(chain: EvmChain, onEvent: (pair: NewPairEvent) => void): Unsubscribe {
  const cfg = evmConfig(chain);
  if (!cfg.factoryAddress || !cfg.wrappedNativeAddress) {
    throw new Error(`No V2 factory configured for ${chain} — Sniper is disabled for this chain/network.`);
  }
  const client = watchClient(cfg);
  const wrapped = cfg.wrappedNativeAddress.toLowerCase();

  return client.watchContractEvent({
    address: cfg.factoryAddress,
    abi: FACTORY_V2_ABI,
    eventName: "PairCreated",
    onLogs: (logs) => {
      for (const l of logs) {
        const args = l.args;
        if (!args.token0 || !args.token1 || !args.pair) continue;
        const token0 = args.token0.toLowerCase();
        const token1 = args.token1.toLowerCase();
        // Only surface pairs against the native asset — that's what Router can buy into directly.
        if (token0 !== wrapped && token1 !== wrapped) continue;
        const tokenAddress = token0 === wrapped ? args.token1 : args.token0;
        onEvent({
          chain,
          tokenAddress,
          pairAddress: args.pair,
          dex: DEX_LABELS[chain],
          detectedAt: Date.now(),
        });
      }
    },
    onError: (err) => log.warn({ err, chain }, "watchNewPairs error"),
  });
}

/** Watches ERC20 Transfer logs plus native-token transfers touching `address`. */
export function watchEvmWallet(
  chain: EvmChain,
  address: string,
  onEvent: (activity: WalletActivity) => void,
): Unsubscribe {
  const cfg = evmConfig(chain);
  const client = watchClient(cfg);
  const watched = address as `0x${string}`;

  const toTokenActivity = (side: "buy" | "sell") => (logs: Log[]) => {
    for (const l of logs) {
      const args = (l as unknown as { args: { value: bigint } }).args;
      onEvent({
        chain,
        watchedAddress: address,
        txHash: l.transactionHash ?? "",
        side,
        tokenAddress: l.address,
        amount: args.value.toString(),
        detectedAt: Date.now(),
      });
    }
  };

  // No `address` filter — this watches the given event signature/args across all
  // contracts on the chain, not just one known token, since the watched wallet
  // can trade any token.
  const unwatchOutgoing = client.watchContractEvent({
    abi: ERC20_ABI,
    eventName: "Transfer",
    args: { from: watched },
    onLogs: toTokenActivity("sell"),
    onError: (err) => log.warn({ err, chain }, "watchWallet (outgoing) error"),
  });
  const unwatchIncoming = client.watchContractEvent({
    abi: ERC20_ABI,
    eventName: "Transfer",
    args: { to: watched },
    onLogs: toTokenActivity("buy"),
    onError: (err) => log.warn({ err, chain }, "watchWallet (incoming) error"),
  });

  const unwatchBlocks = client.watchBlocks({
    includeTransactions: true,
    onBlock: (block) => {
      for (const tx of block.transactions) {
        if (typeof tx === "string") continue;
        const isFrom = tx.from.toLowerCase() === address.toLowerCase();
        const isTo = tx.to?.toLowerCase() === address.toLowerCase();
        if (!isFrom && !isTo) continue;
        if (tx.value === 0n) continue;
        onEvent({
          chain,
          watchedAddress: address,
          txHash: tx.hash,
          side: isFrom ? "sell" : "buy",
          tokenAddress: NATIVE_TOKEN_ADDRESS,
          amount: tx.value.toString(),
          detectedAt: Date.now(),
        });
      }
    },
    onError: (err) => log.warn({ err, chain }, "watchWallet (blocks) error"),
  });

  return () => {
    unwatchOutgoing();
    unwatchIncoming();
    unwatchBlocks();
  };
}
