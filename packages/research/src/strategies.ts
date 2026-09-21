import type { OpportunitySnapshot, StrategyName, StrategySignal } from "./types.js";

export interface Strategy { readonly name: StrategyName; evaluate(snapshot: OpportunitySnapshot): StrategySignal; }
function signal(strategy:StrategyName,score:number,reasons:string[],decision:StrategySignal["decision"]):StrategySignal {
  return {strategy,decision,score:Math.max(0,Math.min(100,score)),confidence:Math.max(0,Math.min(1,score/100)),reasons,generatedAt:Date.now()};
}
export class ConservativeStrategy implements Strategy {
  readonly name="conservative" as const;
  evaluate(s:OpportunitySnapshot):StrategySignal {
    const f=s.features; let score=0; const r:string[]=[];
    if(s.safetyLevel>=3){score+=35;r.push("Safety level supports conservative entry");}
    if((f.liquidityUsd??0)>=25000){score+=25;r.push("Strong liquidity");}
    if((f.holderDistributionScore??0)>=60){score+=15;r.push("Holder concentration is relatively moderate");}
    if((f.buySellRatio??0)>=1.25){score+=15;r.push("Buy pressure exceeds sell pressure");}
    if((f.priceVelocityPct??0)>0){score+=10;r.push("Positive price velocity");}
    return signal(this.name,score,r,s.safetyLevel<2?"REJECT":score>=70?"BUY":"WAIT");
  }
}
export class MomentumStrategy implements Strategy {
  readonly name="momentum" as const;
  evaluate(s:OpportunitySnapshot):StrategySignal {
    const f=s.features; let score=0; const r:string[]=[];
    if(s.safetyLevel>=2)score+=25;
    if((f.volumeLiquidityRatio??0)>=1){score+=20;r.push("Volume is active relative to liquidity");}
    if((f.buySellRatio??0)>=1.5){score+=20;r.push("Strong buy/sell imbalance");}
    if((f.priceVelocityPct??0)>5){score+=20;r.push("Positive short-term price velocity");}
    if((f.priceAccelerationPct??0)>0){score+=15;r.push("Price movement is accelerating");}
    return signal(this.name,score,r,s.safetyLevel<2?"REJECT":score>=70?"BUY":"WAIT");
  }
}
export class EarlyEntryStrategy implements Strategy {
  readonly name="early-entry" as const;
  evaluate(s:OpportunitySnapshot):StrategySignal {
    const f=s.features; const age=s.observation.launchTime?Date.now()-s.observation.launchTime:Infinity; let score=0; const r:string[]=[];
    if(s.safetyLevel>=2)score+=30;
    if(age<=30*60*1000){score+=20;r.push("Launch is recent");}
    if((f.liquidityChangePct??0)>0){score+=15;r.push("Liquidity is increasing");}
    if((f.buySellRatio??0)>=1.2){score+=15;r.push("Early buy pressure is positive");}
    if((f.walletActivityScore??0)>=50){score+=20;r.push("Observed wallet activity is supportive");}
    return signal(this.name,score,r,s.safetyLevel<2?"REJECT":score>=70?"BUY":"WAIT");
  }
}
export class SpeculativeStrategy implements Strategy {
  readonly name="speculative" as const;
  evaluate(s:OpportunitySnapshot):StrategySignal {
    const f=s.features; let score=0; const r:string[]=[];
    if(s.safetyLevel>=2)score+=25;
    if((f.priceVelocityPct??0)>10)score+=20;
    if((f.priceAccelerationPct??0)>5)score+=20;
    if((f.buySellRatio??0)>1.5)score+=20;
    if((f.volumeLiquidityRatio??0)>0.5)score+=15;
    return signal(this.name,score,r,s.safetyLevel<2?"REJECT":score>=70?"BUY":"WAIT");
  }
}
export const defaultStrategies:Strategy[]=[new ConservativeStrategy(),new MomentumStrategy(),new EarlyEntryStrategy(),new SpeculativeStrategy()];
