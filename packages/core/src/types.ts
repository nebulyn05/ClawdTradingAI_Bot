/** Every chain the platform knows about. Monad/Robinhood are registered but stubbed. */
export const CHAINS = ["solana", "ethereum", "bsc", "base", "monad", "robinhood"] as const;
export type Chain = (typeof CHAINS)[number];

export type NetworkMode = "testnet" | "mainnet";

export interface EncryptedKey {
  /** Ciphertext of the private key, base64. */
  ciphertext: string;
  /** AES-GCM auth tag, base64. */
  authTag: string;
  /** AES-GCM IV, base64. */
  iv: string;
  /** The per-wallet data key, wrapped (encrypted) by the server master key, base64. */
  wrappedDataKey: string;
  /** IV used to wrap the data key, base64. */
  wrapIv: string;
  /** Auth tag for the wrapped data key, base64. */
  wrapAuthTag: string;
}

export interface WalletHandle {
  chain: Chain;
  address: string;
  network: NetworkMode;
}

/** A newly observed liquidity pair / token launch, emitted by Sniper. */
export interface NewPairEvent {
  chain: Chain;
  tokenAddress: string;
  pairAddress: string;
  dex: string;
  baseSymbol?: string;
  detectedAt: number;
}

/** Activity observed on a watched (smart-money) wallet, emitted by Scout. */
export interface WalletActivity {
  chain: Chain;
  watchedAddress: string;
  txHash: string;
  side: "buy" | "sell";
  tokenAddress: string;
  amount: string;
  detectedAt: number;
}

/** A cross-chain price-spread opportunity, emitted by Arbiter. */
export interface ArbitrageOpportunity {
  asset: string;
  buyChain: Chain;
  sellChain: Chain;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  estimatedBridgeCostPct: number;
  detectedAt: number;
}

export type SignalSource = "sniper" | "scout" | "arbiter";

/** A candidate trade opportunity fed into Guard for screening. */
export interface TradeCandidate {
  source: SignalSource;
  chain: Chain;
  tokenAddress: string;
  reason: string;
  detectedAt: number;
}

export interface SafetyCheckResult {
  chain: Chain;
  tokenAddress: string;
  passed: boolean;
  score: number; // 0-100
  checks: Record<string, boolean>;
  reasons: string[];
  checkedAt: number;
}

export interface Quote {
  chain: Chain;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  priceImpactPct: number;
  route: string;
  raw: unknown;
}

export interface TxResult {
  chain: Chain;
  txHash: string;
  status: "confirmed" | "failed";
  amountIn: string;
  amountOut: string;
  price: number;
}

export type PositionStatus = "open" | "closed";
export type ExitReason = "take_profit" | "stop_loss" | "manual" | "guard_exit";

/** Domain events published on the internal EventBus, connecting specialists together. */
export interface DomainEvents {
  "sniper.newPair": NewPairEvent;
  "scout.walletActivity": WalletActivity;
  "arbiter.opportunity": ArbitrageOpportunity;
  "guard.result": SafetyCheckResult;
  "router.positionOpened": {
    userId: string;
    positionId: string;
    chain: Chain;
    tokenAddress: string;
    entryPrice: number;
    takeProfitPrice: number;
    stopLossPrice: number;
  };
  "router.positionClosed": {
    userId: string;
    positionId: string;
    chain: Chain;
    tokenAddress: string;
    exitPrice: number;
    reason: ExitReason;
    profitable: boolean;
    profitAmount: string;
    feeAmount: string;
  };
  "guard.rejected": {
    chain: Chain;
    tokenAddress: string;
    reasons: string[];
  };
}
