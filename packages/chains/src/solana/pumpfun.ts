import { Connection, PublicKey } from "@solana/web3.js";
import type { NewPairEvent } from "@clawd/core";
import { createLogger } from "@clawd/core";

const log = createLogger("chains:solana:pumpfun");

// Pump.fun's program ID (mainnet + devnet share this address).
const PUMP_FUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

/**
 * Subscribes to Pump.fun "Create" (new token launch) events via log subscription.
 *
 * Versioned Solana transactions may use Address Lookup Tables (ALTs). We resolve
 * those tables before reading account keys; otherwise web3.js throws
 * "Failed to get account keys because address table lookups were not resolved".
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

        const message = tx.transaction.message;
        const lookupTables = message.addressTableLookups ?? [];

        const lookupAccounts = await Promise.all(
          lookupTables.map(async (lookup) => {
            const result = await connection.getAddressLookupTable(lookup.accountKey);
            return result.value;
          }),
        );

        const missingLookup = lookupAccounts.some((value) => value === null);
        if (missingLookup) {
          log.warn({ signature: logInfo.signature }, "Pump.fun transaction referenced an unavailable address lookup table");
          return;
        }

        const resolvedKeys = message.getAccountKeys({
          addressLookupTableAccounts: lookupAccounts.filter(
            (value): value is NonNullable<typeof value> => value !== null,
          ),
        });

        const compiled = "compiledInstructions" in message
          ? message.compiledInstructions
          : message.instructions;
        const pumpInstruction = compiled.find((instruction) => {
          const programId = resolvedKeys.get(instruction.programIdIndex);
          return programId?.equals(PUMP_FUN_PROGRAM_ID) ?? false;
        });

        const instructionAccountIndexes = pumpInstruction
          ? ("accountKeyIndexes" in pumpInstruction ? pumpInstruction.accountKeyIndexes : pumpInstruction.accounts)
          : [];
        const instructionAccounts = instructionAccountIndexes
          .map((index) => resolvedKeys.get(index))
          .filter((value): value is PublicKey => value !== undefined);

        // Pump.fun create/create_v2 account order starts with mint,
        // mint-authority, then bonding-curve. This is more reliable than
        // assuming a fixed transaction-wide account-key index.
        const mint = instructionAccounts[0]?.toBase58();
        if (!mint) return;
        const bondingCurve = instructionAccounts[2]?.toBase58();

        onEvent({
          chain: "solana",
          tokenAddress: mint,
          pairAddress: bondingCurve ?? mint,
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
