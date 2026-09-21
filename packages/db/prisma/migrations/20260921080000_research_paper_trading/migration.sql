CREATE TYPE "ResearchSignalDecision" AS ENUM ('BUY', 'WATCH', 'WAIT', 'REJECT');
CREATE TYPE "ResearchStrategy" AS ENUM ('conservative', 'momentum', 'early_entry', 'speculative');
CREATE TYPE "ResearchPositionStatus" AS ENUM ('open', 'closed');

CREATE TABLE "research_opportunities" (
  "id" TEXT NOT NULL,
  "chain" "Chain" NOT NULL,
  "tokenAddress" TEXT NOT NULL,
  "pairAddress" TEXT,
  "dex" TEXT,
  "source" TEXT NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL,
  "launchTime" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "research_opportunities_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "research_opportunities_chain_tokenAddress_idx" ON "research_opportunities"("chain","tokenAddress");
CREATE INDEX "research_opportunities_detectedAt_idx" ON "research_opportunities"("detectedAt");

CREATE TABLE "research_observations" (
  "id" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "priceUsd" DOUBLE PRECISION,
  "liquidityUsd" DOUBLE PRECISION,
  "marketCapUsd" DOUBLE PRECISION,
  "volumeUsd" DOUBLE PRECISION,
  "buyCount" INTEGER,
  "sellCount" INTEGER,
  "uniqueBuyers" INTEGER,
  "uniqueSellers" INTEGER,
  "holderCount" INTEGER,
  "top10HolderPct" DOUBLE PRECISION,
  "creatorWallet" TEXT,
  "creatorLaunches" INTEGER,
  "creatorRugs" INTEGER,
  "creatorSuccessful" INTEGER,
  "liquidityChangePct" DOUBLE PRECISION,
  "walletActivityScore" DOUBLE PRECISION,
  "priceVelocityPct" DOUBLE PRECISION,
  "priceAccelerationPct" DOUBLE PRECISION,
  "rugIndicators" JSONB,
  "safetyScore" INTEGER,
  "safetyLevel" INTEGER,
  "safetyPassed" BOOLEAN,
  "features" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "research_observations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_observations_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "research_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "research_observations_opportunityId_observedAt_idx" ON "research_observations"("opportunityId","observedAt");

CREATE TABLE "research_signals" (
  "id" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "strategy" "ResearchStrategy" NOT NULL,
  "decision" "ResearchSignalDecision" NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "reasons" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "research_signals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_signals_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "research_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "research_signals_strategy_generatedAt_idx" ON "research_signals"("strategy","generatedAt");
CREATE INDEX "research_signals_opportunityId_idx" ON "research_signals"("opportunityId");

CREATE TABLE "research_paper_positions" (
  "id" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "strategy" "ResearchStrategy" NOT NULL,
  "chain" "Chain" NOT NULL,
  "tokenAddress" TEXT NOT NULL,
  "entryPriceUsd" DOUBLE PRECISION NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "investedUsd" DOUBLE PRECISION NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL,
  "currentPriceUsd" DOUBLE PRECISION NOT NULL,
  "status" "ResearchPositionStatus" NOT NULL DEFAULT 'open',
  "exitPriceUsd" DOUBLE PRECISION,
  "closedAt" TIMESTAMP(3),
  "pnlUsd" DOUBLE PRECISION,
  "returnPct" DOUBLE PRECISION,
  "exitReason" TEXT,
  CONSTRAINT "research_paper_positions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_paper_positions_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "research_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "research_paper_positions_status_openedAt_idx" ON "research_paper_positions"("status","openedAt");
CREATE INDEX "research_paper_positions_strategy_tokenAddress_idx" ON "research_paper_positions"("strategy","tokenAddress");

CREATE TABLE "research_paper_trades" (
  "id" TEXT NOT NULL,
  "positionId" TEXT NOT NULL,
  "side" "TradeSide" NOT NULL,
  "priceUsd" DOUBLE PRECISION NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "notionalUsd" DOUBLE PRECISION NOT NULL,
  "feeUsd" DOUBLE PRECISION NOT NULL,
  "slippagePct" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "research_paper_trades_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_paper_trades_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "research_paper_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "research_paper_trades_positionId_idx" ON "research_paper_trades"("positionId");

CREATE TABLE "research_outcomes" (
  "id" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "return5mPct" DOUBLE PRECISION,
  "return10mPct" DOUBLE PRECISION,
  "return15mPct" DOUBLE PRECISION,
  "return30mPct" DOUBLE PRECISION,
  "return1hPct" DOUBLE PRECISION,
  "return2hPct" DOUBLE PRECISION,
  "peakGainPct" DOUBLE PRECISION,
  "maxDrawdownPct" DOUBLE PRECISION,
  "timeToPeakSec" INTEGER,
  "timeToStopSec" INTEGER,
  "finalReturnPct" DOUBLE PRECISION,
  "rugged" BOOLEAN NOT NULL DEFAULT false,
  "liquidityRemoved" BOOLEAN NOT NULL DEFAULT false,
  "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "research_outcomes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_outcomes_opportunityId_key" UNIQUE ("opportunityId"),
  CONSTRAINT "research_outcomes_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "research_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
