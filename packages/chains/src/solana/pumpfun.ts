import { Connection, PublicKey } from "@solana/web3.js";
import type { NewPairEvent } from "@clawd/core";
import { createLogger } from "@clawd/core";

const log = createLogger("chains:solana:pumpfun");

// Pump.fun's program ID (mainnet + devnet share this address).
const PUMP_FUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

/**
 * Subscribes to Pump.fun token creation events via log subscription.
 *
 * Current Pump.fun launches can use both the legacy Create instruction and
 * CreateV2. Versioned transactions may also use Address Lookup Tables (ALTs),
 * so those tables are resolved before reading account keys.
 */
export function watchPumpFunLaunches(
  connection: Connection,
  onEvent: (pair: NewPairEvent) => void,
): () => void {
  const subId = connection.onLogs(
    PUMP_FUN_PROGRAM_ID,
    async (logInfo) => {
      if (logInfo.err) return;

      // Pump.fun currently emits both "Instruction: Create" and
      // "Instruction: CreateV2" for token launches. Do not require the
      // legacy log string or CreateV2 launches will be silently missed.
      const isCreate = logInfo.logs.some(
        (line) => line.includes("Instruction: Create") || line.includes("Instruction: CreateV2"),
      );
      if (!isCreate) return;

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
          log.warn(
            { signature: logInfo.signature },
            "Pump.fun transaction referenced an unavailable address lookup table",
          );
          return;
        }

        const resolvedKeys = message.getAccountKeys({
          addressLookupTableAccounts: lookupAccounts.filter(
            (value): value is NonNullable<typeof value> => value !== null,
          ),
        });

        const compiled = (message as unknown as {
          compiledInstructions?: Array<{
            programIdIndex: number;
            accountKeyIndexes: number[];
            data?: Uint8Array | Buffer;
          }>;
        }).compiledInstructions ?? [];

        const pumpInstruction = compiled.find((instruction) => {
          const programId = resolvedKeys.get(instruction.programIdIndex);
          return programId?.equals(PUMP_FUN_PROGRAM_ID) ?? false;
        });

        const instructionAccountIndexes = pumpInstruction?.accountKeyIndexes ?? [];
        const instructionAccounts = instructionAccountIndexes
          .map((index) => resolvedKeys.get(index))
          .filter((value): value is PublicKey => value !== undefined);

        // Both Create and CreateV2 place the mint, mint authority and
        // bonding curve at the first three instruction accounts.
        const mint = instructionAccounts[0]?.toBase58();
        if (!mint) return;

        const bondingCurve = instructionAccounts[2]?.toBase58();

        log.info(
          {
            signature: logInfo.signature,
            instructionAccounts: instructionAccounts.map((account) => account.toBase58()),
            mint,
            bondingCurve,
          },
          "Pump.fun launch decoded",
        );

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
