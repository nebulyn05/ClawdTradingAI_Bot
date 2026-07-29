import { Connection, Keypair, PublicKey, SystemProgram, Transaction, type VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { loadConfig, createLogger } from "@clawd/core";

const log = createLogger("chains:solana:jito");

function pickTipAccount(tipAccountsCsv: string): PublicKey {
  const accounts = tipAccountsCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (accounts.length === 0) {
    throw new Error("JITO_TIP_ACCOUNTS is empty — set at least one Jito tip account pubkey.");
  }
  const choice = accounts[Math.floor(Math.random() * accounts.length)]!;
  return new PublicKey(choice);
}

/**
 * Submits `swapTx` as a Jito bundle (paired with a tip transaction) for
 * MEV-protected/priority inclusion, instead of the public mempool. Returns
 * the swap transaction's own signature — the caller confirms it via the
 * regular RPC connection exactly as it would a normally-submitted tx; the
 * bundle only changes *how* it lands in a block, not how you check on it
 * afterward.
 *
 * Verify JITO_TIP_ACCOUNTS and JITO_BLOCK_ENGINE_URL against
 * https://docs.jito.wtf before relying on this with real size — tip
 * accounts do get rotated, and this hasn't been exercised against a live,
 * funded wallet in this environment.
 */
export async function submitViaJitoBundle(
  connection: Connection,
  keypair: Keypair,
  swapTx: VersionedTransaction,
): Promise<string> {
  const cfg = loadConfig();
  const tipAccount = pickTipAccount(cfg.JITO_TIP_ACCOUNTS);

  const { blockhash } = await connection.getLatestBlockhash();
  const tipTx = new Transaction({ recentBlockhash: blockhash, feePayer: keypair.publicKey }).add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: tipAccount,
      lamports: cfg.JITO_TIP_LAMPORTS,
    }),
  );
  tipTx.sign(keypair);

  const bundle = [bs58.encode(swapTx.serialize()), bs58.encode(tipTx.serialize())];

  const res = await fetch(cfg.JITO_BLOCK_ENGINE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendBundle", params: [bundle] }),
  });
  if (!res.ok) {
    throw new Error(`Jito bundle submission failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { result?: string; error?: unknown };
  if (data.error) {
    throw new Error(`Jito bundle rejected: ${JSON.stringify(data.error)}`);
  }
  log.info({ bundleId: data.result }, "Submitted Jito bundle");

  const signature = bs58.encode(swapTx.signatures[0]!);
  return signature;
}
