import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  getMint,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import bs58 from "bs58";
import type { TxResult } from "@clawd/core";

/** Balance + decimals for an arbitrary SPL token mint — 0 balance (not an error) if the wallet has no token account for it yet. */
export async function getSplTokenBalance(
  connection: Connection,
  tokenMint: string,
  walletAddress: string,
): Promise<{ balance: bigint; decimals: number }> {
  const mint = new PublicKey(tokenMint);
  const owner = new PublicKey(walletAddress);
  const [mintInfo, ata] = await Promise.all([getMint(connection, mint), getAssociatedTokenAddress(mint, owner)]);
  try {
    const account = await getAccount(connection, ata);
    return { balance: account.amount, decimals: mintInfo.decimals };
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) return { balance: 0n, decimals: mintInfo.decimals };
    throw err;
  }
}

/**
 * Sends `amount` (already in the token's smallest unit) of an SPL token to
 * `toAddress`. Creates the recipient's associated token account in the same
 * transaction if it doesn't exist yet — paid for by the sender, the standard
 * pattern, so the recipient never needs to pre-fund or sign anything.
 */
export async function transferSplToken(
  connection: Connection,
  rawSecretKeyBase58: string,
  tokenMint: string,
  toAddress: string,
  amount: bigint,
): Promise<TxResult> {
  const keypair = Keypair.fromSecretKey(bs58.decode(rawSecretKeyBase58));
  const mint = new PublicKey(tokenMint);
  const toOwner = new PublicKey(toAddress);

  const fromAta = await getAssociatedTokenAddress(mint, keypair.publicKey);
  const toAta = await getAssociatedTokenAddress(mint, toOwner);

  const tx = new Transaction();
  const toAtaInfo = await connection.getAccountInfo(toAta);
  if (!toAtaInfo) {
    tx.add(createAssociatedTokenAccountInstruction(keypair.publicKey, toAta, toOwner, mint));
  }
  tx.add(createTransferInstruction(fromAta, toAta, keypair.publicKey, amount));

  const signature = await sendAndConfirmTransaction(connection, tx, [keypair]);

  return {
    chain: "solana",
    txHash: signature,
    status: "confirmed",
    amountIn: amount.toString(),
    amountOut: amount.toString(),
    price: 1,
  };
}
