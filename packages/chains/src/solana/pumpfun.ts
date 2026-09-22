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
  const seenSignatures = new Set<string>();

  const decodeTransaction = async (signature: string, source: "logs" | "poll") => {
    if (seenSignatures.has(signature)) return;
    seenSignatures.add(signature);
    if (seenSignatures.size > 5000) {
      const oldest = seenSignatures.values().next().value as string | undefined;
      if (oldest) seenSignatures.delete(oldest);
    }

    try {
      const tx = await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) return;

      const logs = tx.meta?.logMessages ?? [];
      const isCreate = logs.some(
        (line) => line.includes("Instruction: Create") || line.includes("Instruction: CreateV2"),
      );
      if (!isCreate) return;

      const message = tx.transaction.message;
      const lookupTables = message.addressTableLookups ?? [];

      const lookupAccounts = await Promise.all(
        lookupTables.map(async (lookup) => {
          const result = await connection.getAddressLookupTable(lookup.accountKey);
          return result.value;
        }),
      );

      if (lookupAccounts.some((value) => value === null)) {
        log.warn(
          { signature, source },
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
          signature,
          source,
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
      log.warn({ err, signature, source }, "Failed to parse Pump.fun create tx");
    }
  };

  const subId = connection.onLogs(
    PUMP_FUN_PROGRAM_ID,
    async (logInfo) => {
      if (logInfo.err) return;

      const isCreate = logInfo.logs.some(
        (line) => line.includes("Instruction: Create") || line.includes("Instruction: CreateV2"),
      );
      if (!isCreate) return;

      await decodeTransaction(logInfo.signature, "logs");
    },
    "confirmed",
  );

  log.info({ subscriptionId: subId }, "Pump.fun launch log subscription active");

  let polling = false;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      const signatures = await connection.getSignaturesForAddress(PUMP_FUN_PROGRAM_ID, {
        limit: 25,
      }, "confirmed");

      const unseen = signatures
        .map((entry) => entry.signature)
        .filter((signature) => !seenSignatures.has(signature));

      log.debug(
        { recentProgramSignatures: signatures.length, unseenProgramSignatures: unseen.length },
        "Pump.fun launch poll",
      );

      // HTTP polling is an independent detection path from websocket logs.
      // Keep the batch deliberately small to avoid hammering public RPCs.
      for (const signature of unseen.slice(0, 8)) {
        await decodeTransaction(signature, "poll");
      }
    } catch (err) {
      log.warn({ err }, "Pump.fun launch polling failed");
    } finally {
      polling = false;
    }
  };

  const pollTimer = setInterval(() => {
    void poll();
  }, 3000);

  void poll();

  return () => {
    clearInterval(pollTimer);
    connection.removeOnLogsListener(subId).catch((err) => log.warn({ err }, "unsubscribe failed"));
  };
}
