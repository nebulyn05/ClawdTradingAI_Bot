import { getStatus } from "@lifi/sdk";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createLogger, type Chain, type EncryptedKey } from "@clawd/core";
import { evmConfig, isEvmChain, type EvmChain } from "@clawd/chains";
import { withDecryptedKey } from "@clawd/wallet";
import { getLifiClient, LIFI_CHAIN_IDS } from "./lifi-client.js";
import { getLifiStep } from "./lifi-quote.js";

const log = createLogger("arbiter:execute");

export interface CrossChainExecutionResult {
  sourceTxHash: string;
  bridgeStatus: "PENDING" | "DONE" | "FAILED" | "UNKNOWN";
}

/**
 * Executes a cross-chain arbitrage leg — bridges `tokenAddress` from
 * `fromChain` to `toChain` via LI.FI (the buy/sell swaps around it are
 * separate, ordinary same-chain trades through the usual chain adapter).
 *
 * EVM-to-EVM only. LI.FI's Solana-side execution needs a dedicated SVM
 * transaction encoding — the installed SDK's `TransactionRequest` type is
 * EVM-shaped only (to/data/value/chainId), not something a Solana signer
 * could use, and this session's blocked network access meant LI.FI's docs
 * for their SVM provider couldn't be checked. Solana legs return null with
 * a clear log message rather than attempting something unverified; the
 * quote/cost-estimation side (lifi-quote.ts) does support Solana, since
 * that only needed the (verified) numeric chain ID, not a signer.
 */
export async function executeCrossChainArbitrage(
  fromChain: Chain,
  toChain: Chain,
  tokenAddress: string,
  amount: bigint,
  encryptedKey: EncryptedKey,
): Promise<CrossChainExecutionResult | null> {
  if (!isEvmChain(fromChain) || !isEvmChain(toChain)) {
    log.warn(
      { fromChain, toChain },
      "Cross-chain execution only supports EVM<->EVM legs right now — see module comment for why Solana legs are excluded",
    );
    return null;
  }

  return withDecryptedKey(encryptedKey, async (rawKey) => {
    const account = privateKeyToAccount(rawKey as `0x${string}`);
    const step = await getLifiStep(fromChain, toChain, tokenAddress, amount, account.address);
    if (!step?.transactionRequest) {
      log.warn({ fromChain, toChain }, "LI.FI did not return an executable transaction request");
      return null;
    }

    const fromCfg = evmConfig(fromChain as EvmChain);
    const publicClient = createPublicClient({ chain: fromCfg.viemChain, transport: http(fromCfg.rpcUrl) });
    const walletClient = createWalletClient({
      account,
      chain: fromCfg.viemChain,
      transport: http(fromCfg.rpcUrl),
    });

    const tx = step.transactionRequest;
    const hash = await walletClient.sendTransaction({
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}` | undefined,
      value: tx.value !== undefined ? BigInt(tx.value.toString()) : undefined,
      account,
      chain: fromCfg.viemChain,
    });
    await publicClient.waitForTransactionReceipt({ hash });

    const status = await getStatus(getLifiClient(), {
      txHash: hash,
      bridge: step.tool,
      fromChain: LIFI_CHAIN_IDS[fromChain],
      toChain: LIFI_CHAIN_IDS[toChain],
    }).catch((err) => {
      log.warn({ err }, "LI.FI status check failed — bridge tx was submitted, status unknown");
      return null;
    });

    return {
      sourceTxHash: hash,
      bridgeStatus: (status?.status as CrossChainExecutionResult["bridgeStatus"] | undefined) ?? "UNKNOWN",
    };
  });
}
