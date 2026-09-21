import type { MarketObservation, OpportunitySnapshot, SafetyLevel } from "./types.js";

export function buildFeatures(o: MarketObservation): Record<string, number> {
  const liquidity = Math.max(0, o.liquidityUsd ?? 0);
  const volume = Math.max(0, o.volumeUsd ?? 0);
  const buys = Math.max(0, o.buyCount ?? 0);
  const sells = Math.max(0, o.sellCount ?? 0);
  const buyers = Math.max(0, o.uniqueBuyers ?? 0);
  const sellers = Math.max(0, o.uniqueSellers ?? 0);
  const holderPct = Math.max(0, o.top10HolderPct ?? 100);
  return {
    liquidityUsd: liquidity,
    volumeUsd: volume,
    volumeLiquidityRatio: liquidity > 0 ? volume / liquidity : 0,
    buySellRatio: sells > 0 ? buys / sells : buys > 0 ? buys : 0,
    buyerSellerRatio: sellers > 0 ? buyers / sellers : buyers > 0 ? buyers : 0,
    holderDistributionScore: Math.max(0, 100 - holderPct),
    liquidityChangePct: o.liquidityChangePct ?? 0,
    walletActivityScore: o.walletActivityScore ?? 0,
    priceVelocityPct: o.priceVelocityPct ?? 0,
    priceAccelerationPct: o.priceAccelerationPct ?? 0,
    creatorRugRate: creatorRugRate(o)
  };
}
function creatorRugRate(o: MarketObservation): number {
  const h = o.creatorHistory;
  if (!h || !h.launches || h.launches <= 0) return 0;
  return Math.max(0, Math.min(1, (h.rugs ?? 0) / h.launches));
}
export function classifySafety(score:number, passed:boolean, observation:MarketObservation):{score:number;level:SafetyLevel;passed:boolean} {
  if (!passed || (observation.rugIndicators?.length ?? 0) > 0) return {score:Math.max(0,score),level:0,passed:false};
  if (score < 60) return {score,level:1,passed:false};
  if (score < 75) return {score,level:2,passed:true};
  if (score < 90) return {score,level:3,passed:true};
  return {score,level:4,passed:true};
}
export function buildSnapshot(observation:MarketObservation,safetyScore:number,safetyPassed:boolean):OpportunitySnapshot {
  const safety=classifySafety(safetyScore,safetyPassed,observation);
  return {observation,safetyScore:safety.score,safetyLevel:safety.level,safetyPassed:safety.passed,features:buildFeatures(observation)};
}
