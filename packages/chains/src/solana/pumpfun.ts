import { Connection, PublicKey } from "@solana/web3.js";
import type { NewPairEvent } from "@clawd/core";
import { createLogger } from "@clawd/core";

const log = createLogger("chains:solana:pumpfun");

// Pump.fun's program ID (mainnet + devnet share this address).
const PUMP_FUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

/**
 * Subscribes to Pump.fun "Create" (new token launch) events via log subscription.
 *
 * The mint address is extracted heuristically from the transaction's static
 * account keys (slot 1, matching Pump.fun's current Create instruction account
 * order) rather than a full Anchor IDL decode. This is good enough to detect
 * *that* a launch happened, but should be replaced with proper instruction
 * decoding (or Helius' enhanced/parsed webhook API) before relying on it for
 * real capital — the account-key slot is not a stable protocol guarantee.
 */
export function watchPumpFunLaunches(
  connection: Connection,
  onEvent: (pair: NewPairEvent) => void,
): () => void {
  const subId = connection.onLogs(
    PUMP_FUN_PROGRAM_ID,
    async (logInfo) => {
      if (logInfo.err) return;
      if (!logInfo.logs.some((l) => l.includes("Instruction: Create"))) return;

      try {
        const tx = await connection.getTransaction(logInfo.signature, {
          maxSupportedTransactionVersion: 0,
        });
        if (!tx) return;

        const accountKeys = tx.transaction.message.getAccountKeys().staticAccountKeys;
        const mint = accountKeys[1]?.toBase58();
        if (!mint) return;

        onEvent({
          chain: "solana",
          tokenAddress: mint,
          pairAddress: mint, // pre-migration, the bonding curve is keyed by the mint itself
          dex: "pump.fun",
          detectedAt: Date.now(),
        });
      } catch (err) {
        log.warn({ err, signature: logInfo.signature }, "Failed to parse Pump.fun create tx");
      }
    },
    "confirmed",
  );

  return () => {
    connection.removeOnLogsListener(subId).catch((err) => log.warn({ err }, "unsubscribe failed"));
  };
}
