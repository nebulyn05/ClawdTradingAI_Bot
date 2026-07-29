import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { TxResult } from "@clawd/core";

/** Sends `lamports` of native SOL from the keypair behind `rawSecretKeyBase58` to `toAddress`. */
export async function withdrawSol(
  connection: Connection,
  rawSecretKeyBase58: string,
  toAddress: string,
  lamports: bigint,
): Promise<TxResult> {
  const keypair = Keypair.fromSecretKey(bs58.decode(rawSecretKeyBase58));
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(toAddress),
      lamports,
    }),
  );
  const signature = await sendAndConfirmTransaction(connection, tx, [keypair]);

  return {
    chain: "solana",
    txHash: signature,
    status: "confirmed",
    amountIn: lamports.toString(),
    amountOut: lamports.toString(),
    price: 1,
  };
}
