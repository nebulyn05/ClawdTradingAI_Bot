import { Connection, PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import type { WalletActivity, Chain } from "@clawd/core";
import { createLogger } from "@clawd/core";

const log = createLogger("chains:solana:watch-wallet");

/** Subscribes to a wallet's activity, inferring buy/sell from SPL token balance deltas. */
export function watchSolanaWallet(
  connection: Connection,
  chain: Chain,
  address: string,
  onEvent: (activity: WalletActivity) => void,
): () => void {
  const pubkey = new PublicKey(address);
  const subId = connection.onLogs(
    pubkey,
    async (logInfo) => {
      if (logInfo.err) return;
      try {
        const tx = await connection.getParsedTransaction(logInfo.signature, {
          maxSupportedTransactionVersion: 0,
        });
        if (!tx?.meta) return;
        const activity = inferActivity(chain, address, logInfo.signature, tx);
        if (activity) onEvent(activity);
      } catch (err) {
        log.warn({ err, signature: logInfo.signature }, "Failed to parse watched-wallet tx");
      }
    },
    "confirmed",
  );

  return () => {
    connection.removeOnLogsListener(subId).catch((err) => log.warn({ err }, "unsubscribe failed"));
  };
}

function inferActivity(
  chain: Chain,
  watchedAddress: string,
  txHash: string,
  tx: ParsedTransactionWithMeta,
): WalletActivity | null {
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];

  let best: { tokenAddress: string; delta: number } | null = null;
  for (const p of post) {
    if (p.owner !== watchedAddress) continue;
    const before = pre.find((b) => b.accountIndex === p.accountIndex);
    const preAmount = before?.uiTokenAmount.uiAmount ?? 0;
    const postAmount = p.uiTokenAmount.uiAmount ?? 0;
    const delta = postAmount - preAmount;
    if (delta === 0) continue;
    if (!best || Math.abs(delta) > Math.abs(best.delta)) {
      best = { tokenAddress: p.mint, delta };
    }
  }
  if (!best) return null;

  return {
    chain,
    watchedAddress,
    txHash,
    side: best.delta > 0 ? "buy" : "sell",
    tokenAddress: best.tokenAddress,
    amount: Math.abs(best.delta).toString(),
    detectedAt: Date.now(),
  };
}
