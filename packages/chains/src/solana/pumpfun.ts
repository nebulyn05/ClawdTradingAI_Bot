import { Connection, PublicKey } from "@solana/web3.js";
import type { NewPairEvent } from "@clawd/core";
import { AsyncRateLimiter, createLogger, withRpcRetry } from "@clawd/core";

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
  const rpcLimiter = new AsyncRateLimiter(3);
  const fallback = new Connection(process.env.SOLANA_RPC_FALLBACK_URL || "https://api.mainnet-beta.solana.com", "confirmed");
  const processedSignatures = new Set<string>();
  const inFlightSignatures = new Set<string>();

  const rememberProcessed = (signature: string) => {
    processedSignatures.add(signature);
    if (processedSignatures.size > 5000) {
      const oldest = processedSignatures.values().next().value as string | undefined;
      if (oldest) processedSignatures.delete(oldest);
    }
  };

  const decodeTransaction = async (signature: string, source: "logs" | "poll") => {
    if (processedSignatures.has(signature) || inFlightSignatures.has(signature)) return;
    inFlightSignatures.add(signature);

    try {
      let tx = null;
      let lastError: unknown = null;

      try {
        tx = await withRpcRetry(
          () => connection.getTransaction(signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          }),
          rpcLimiter,
        );
      } catch (err) {
        lastError = err;
        try {
          tx = await fallback.getTransaction(signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          if (tx) log.info({ signature, source }, "Pump.fun transaction recovered from fallback RPC");
        } catch (fallbackErr) {
          lastError = fallbackErr;
        }
      }

      if (!tx) {
        log.warn(
          { signature, source, err: lastError },
          "Pump.fun transaction lookup unavailable; will retry later",
        );
        return;
      }

      const logs = tx.meta?.logMessages ?? [];
      const isCreate = logs.some(
        (line) => line.includes("Instruction: Create") || line.includes("Instruction: CreateV2"),
      );

      // We successfully inspected this transaction, so it is safe to suppress
      // future retries even when it was not a token creation.
      rememberProcessed(signature);
      if (!isCreate) return;

      const message = tx.transaction.message;
      const lookupTables = message.addressTableLookups ?? [];

      const lookupAccounts = await Promise.all(
        lookupTables.map(async (lookup) => {
          try {
            const result = await withRpcRetry(() => connection.getAddressLookupTable(lookup.accountKey), rpcLimiter, 3);
            return result.value;
          } catch {
            const fallbackResult = await fallback.getAddressLookupTable(lookup.accountKey);
            return fallbackResult.value;
          }
        }),
      );

      if (lookupAccounts.some((value) => value === null)) {
        log.warn(
          { signature, source },
          "Pump.fun transaction referenced an unavailable address lookup table",
        );
        // The transaction itself was decoded, but its account keys are not
        // currently resolvable. Keep it eligible for a future retry.
        processedSignatures.delete(signature);
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
      // Do not permanently consume the signature after a transient failure.
      processedSignatures.delete(signature);
      log.warn({ err, signature, source }, "Failed to parse Pump.fun create tx");
    } finally {
      inFlightSignatures.delete(signature);
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
      let signatures;
      try {
        signatures = await withRpcRetry(
          () => connection.getSignaturesForAddress(PUMP_FUN_PROGRAM_ID, { limit: 10 }, "confirmed"),
          rpcLimiter,
        );
      } catch (err) {
        log.warn({ err }, "Primary Pump.fun polling RPC unavailable; switching to fallback RPC");
        signatures = await fallback.getSignaturesForAddress(PUMP_FUN_PROGRAM_ID, { limit: 10 }, "confirmed");
      }

      const unseen = signatures
        .map((entry) => entry.signature)
        .filter(
          (signature) =>
            !processedSignatures.has(signature) && !inFlightSignatures.has(signature),
        );

      // Keep this as a low-frequency recovery path. The websocket log
      // subscription is the primary detector; polling only recovers events
      // missed by the subscription.
      log.info(
        { recentProgramSignatures: signatures.length, unseenProgramSignatures: unseen.length },
        "Pump.fun launch poll",
      );

      for (const signature of unseen.slice(0, 2)) {
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
  }, 20_000);

  void poll();

  return () => {
    clearInterval(pollTimer);
    connection.removeOnLogsListener(subId).catch((err) => log.warn({ err }, "unsubscribe failed"));
  };
}
