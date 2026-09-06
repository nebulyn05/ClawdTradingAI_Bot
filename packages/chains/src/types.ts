import type {
  Chain,
  NetworkMode,
  NewPairEvent,
  WalletActivity,
  Quote,
  TxResult,
  EncryptedKey,
} from "@clawd/core";

export type Unsubscribe = () => void;

/**
 * The seam every specialist codes against so trading logic stays
 * chain-agnostic. Implemented per chain in ./solana, ./evm; ./monad and
 * ./robinhood are disabled stubs (see stub.ts).
 */
export interface ChainAdapter {
  readonly chain: Chain;
  readonly network: NetworkMode;
  /** False for stub adapters (Monad/Robinhood) — callers should check this before using the rest. */
  readonly enabled: boolean;

  /** Native-token balance (lamports for Solana, wei for EVM chains) at `address`. */
  getBalance(address: string): Promise<bigint>;

  /** Subscribes to new liquidity pair / token launch events. Call the returned function to stop. */
  watchNewPairs(onEvent: (pair: NewPairEvent) => void): Unsubscribe;

  /** Subscribes to buy/sell activity from a watched (smart-money) wallet. */
  watchWallet(address: string, onEvent: (activity: WalletActivity) => void): Unsubscribe;

  /** Gets a swap quote without executing it. */
  getQuote(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<Quote>;

  /** Decrypts `encryptedKey` transiently, signs, and submits the swap for `quote`. */
  executeSwap(encryptedKey: EncryptedKey, quote: Quote): Promise<TxResult>;

  /** Sends `amount` of the native token from the wallet behind `encryptedKey` to `toAddress`. */
  withdraw(encryptedKey: EncryptedKey, toAddress: string, amount: bigint): Promise<TxResult>;

  /** Balance + decimals for an arbitrary token (ERC20 contract address / SPL mint address) at `walletAddress`. */
  getTokenBalance(tokenAddress: string, walletAddress: string): Promise<{ balance: bigint; decimals: number }>;

  /** Sends `amount` (already in the token's smallest unit) of an arbitrary token from the wallet behind `encryptedKey` to `toAddress`. */
  transferToken(encryptedKey: EncryptedKey, tokenAddress: string, toAddress: string, amount: bigint): Promise<TxResult>;
}
