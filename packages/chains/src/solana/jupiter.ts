import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { loadConfig, networkForChain, getBooleanSetting } from "@clawd/core";
import type { Quote, TxResult } from "@clawd/core";
import { submitViaJitoBundle } from "./jito.js";

interface JupiterQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  [key: string]: unknown;
}

/** Gets a swap quote from Jupiter's public quote API (no key required, rate-limited). */
export async function getJupiterQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
): Promise<Quote> {
  const { JUPITER_API_BASE } = loadConfig();
  const url =
    `${JUPITER_API_BASE}/quote?inputMint=${tokenIn}&outputMint=${tokenOut}` +
    `&amount=${amountIn.toString()}&slippageBps=100`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Jupiter quote failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as JupiterQuoteResponse;

  return {
    chain: "solana",
    tokenIn,
    tokenOut,
    amountIn: data.inAmount,
    amountOut: data.outAmount,
    priceImpactPct: Number(data.priceImpactPct ?? 0),
    route: "jupiter",
    raw: data,
  };
}

/** Builds, signs, and submits the swap transaction for a Jupiter quote. */
export async function executeJupiterSwap(
  connection: Connection,
  rawSecretKeyBase58: string,
  quote: Quote,
): Promise<TxResult> {
  const { JUPITER_API_BASE } = loadConfig();
  const keypair = Keypair.fromSecretKey(bs58.decode(rawSecretKeyBase58));

  const swapRes = await fetch(`${JUPITER_API_BASE}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote.raw,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
    }),
  });
  if (!swapRes.ok) {
    throw new Error(`Jupiter swap build failed (${swapRes.status}): ${await swapRes.text()}`);
  }
  const { swapTransaction } = (await swapRes.json()) as { swapTransaction: string };

  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  tx.sign([keypair]);

  const cfg = loadConfig();
  const jitoEnabled = await getBooleanSetting("JITO_ENABLED", cfg.JITO_ENABLED);
  const signature =
    jitoEnabled && networkForChain("solana") === "mainnet"
      ? await submitViaJitoBundle(connection, keypair, tx)
      : await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const confirmation = await connection.confirmTransaction(signature, "confirmed");

  const amountInNum = Number(quote.amountIn);
  const amountOutNum = Number(quote.amountOut);

  return {
    chain: "solana",
    txHash: signature,
    status: confirmation.value.err ? "failed" : "confirmed",
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    price: amountInNum > 0 ? amountOutNum / amountInNum : 0,
  };
}
