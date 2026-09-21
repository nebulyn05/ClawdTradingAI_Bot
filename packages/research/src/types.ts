import type { Chain } from "@clawd/core";

export type SafetyLevel = 0 | 1 | 2 | 3 | 4;
export type StrategyName = "conservative" | "momentum" | "early-entry" | "speculative";
export type SignalDecision = "BUY" | "WATCH" | "WAIT" | "REJECT";

export interface MarketObservation {
  chain: Chain;
  tokenAddress: string;
  observedAt: number;
  launchTime?: number;
  dex?: string;
  pairAddress?: string;
  priceUsd?: number;
  liquidityUsd?: number;
  marketCapUsd?: number;
  volumeUsd?: number;
  buyCount?: number;
  sellCount?: number;
  uniqueBuyers?: number;
  uniqueSellers?: number;
  holderCount?: number;
  top10HolderPct?: number;
  creatorWallet?: string;
  creatorHistory?: { launches?: number; rugs?: number; successfulLaunches?: number };
  liquidityChangePct?: number;
  walletActivityScore?: number;
  priceVelocityPct?: number;
  priceAccelerationPct?: number;
  rugIndicators?: string[];
}

export interface OpportunitySnapshot {
  observation: MarketObservation;
  safetyScore: number;
  safetyLevel: SafetyLevel;
  safetyPassed: boolean;
  features: Record<string, number>;
}

export interface StrategySignal {
  strategy: StrategyName;
  decision: SignalDecision;
  score: number;
  confidence: number;
  reasons: string[];
  generatedAt: number;
}

export interface PaperPosition {
  id: string;
  chain: Chain;
  tokenAddress: string;
  strategy: StrategyName;
  entryPriceUsd: number;
  quantity: number;
  investedUsd: number;
  openedAt: number;
  currentPriceUsd: number;
  status: "open" | "closed";
  exitPriceUsd?: number;
  closedAt?: number;
  pnlUsd?: number;
  returnPct?: number;
  exitReason?: string;
}

export interface PaperTrade {
  id: string;
  positionId: string;
  side: "buy" | "sell";
  priceUsd: number;
  quantity: number;
  notionalUsd: number;
  feeUsd: number;
  slippagePct: number;
  timestamp: number;
}
