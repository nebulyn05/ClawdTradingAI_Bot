import type { Chain } from "@clawd/core";
import type { PaperPosition, PaperTrade } from "./types.js";

export interface PaperConfig { startingBalanceUsd:number; feeBps:number; slippageBps:number; maxPositionUsd:number; }

export class PaperBroker {
  private balanceUsd:number;
  private readonly positions=new Map<string,PaperPosition>();
  private readonly trades:PaperTrade[]=[];
  constructor(private readonly config:PaperConfig){
    if(config.startingBalanceUsd<=0)throw new Error("startingBalanceUsd must be > 0");
    if(config.maxPositionUsd<0)throw new Error("maxPositionUsd must be >= 0");
    this.balanceUsd=config.startingBalanceUsd;
  }
  getBalanceUsd(){return this.balanceUsd;}
  getPositions(){return [...this.positions.values()];}
  getTrades(){return [...this.trades];}
  buy(input:{chain:Chain;tokenAddress:string;strategy:PaperPosition["strategy"];priceUsd:number;timestamp?:number}):PaperPosition|null{
    if(input.priceUsd<=0||this.config.maxPositionUsd<=0)return null;
    const notional=Math.min(this.config.maxPositionUsd,this.balanceUsd);
    if(notional<=0)return null;
    const slippage=this.config.slippageBps/10000;
    const fee=notional*this.config.feeBps/10000;
    const fillPrice=input.priceUsd*(1+slippage);
    const quantity=(notional-fee)/fillPrice;
    if(quantity<=0)return null;
    const id="paper-"+(this.trades.length+1), now=input.timestamp??Date.now();
    const p:PaperPosition={id,chain:input.chain,tokenAddress:input.tokenAddress,strategy:input.strategy,entryPriceUsd:fillPrice,quantity,investedUsd:notional,openedAt:now,currentPriceUsd:fillPrice,status:"open"};
    this.balanceUsd-=notional; this.positions.set(id,p);
    this.trades.push({id:id+"-buy",positionId:id,side:"buy",priceUsd:fillPrice,quantity,notionalUsd:notional,feeUsd:fee,slippagePct:slippage*100,timestamp:now});
    return p;
  }
  mark(positionId:string,priceUsd:number){
    const p=this.positions.get(positionId);
    if(!p||p.status!=="open")throw new Error("Open paper position not found");
    if(priceUsd<=0)throw new Error("priceUsd must be > 0");
    p.currentPriceUsd=priceUsd; return p;
  }
  sell(positionId:string,priceUsd:number,reason="manual",timestamp=Date.now()){
    const p=this.positions.get(positionId);
    if(!p||p.status!=="open")throw new Error("Open paper position not found");
    if(priceUsd<=0)throw new Error("priceUsd must be > 0");
    const slippage=this.config.slippageBps/10000, fee=p.quantity*priceUsd*this.config.feeBps/10000;
    const fillPrice=priceUsd*(1-slippage), proceeds=Math.max(0,p.quantity*fillPrice-fee);
    this.balanceUsd+=proceeds; p.currentPriceUsd=priceUsd; p.exitPriceUsd=fillPrice; p.closedAt=timestamp; p.status="closed";
    p.pnlUsd=proceeds-p.investedUsd; p.returnPct=p.investedUsd>0?(p.pnlUsd/p.investedUsd)*100:0; p.exitReason=reason;
    this.trades.push({id:p.id+"-sell",positionId:p.id,side:"sell",priceUsd:fillPrice,quantity:p.quantity,notionalUsd:proceeds,feeUsd:fee,slippagePct:slippage*100,timestamp});
    return p;
  }
}
