-- CreateEnum
CREATE TYPE "Chain" AS ENUM ('solana', 'ethereum', 'bsc', 'base', 'monad', 'robinhood');

-- CreateEnum
CREATE TYPE "NetworkMode" AS ENUM ('testnet', 'mainnet');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "ExitReason" AS ENUM ('take_profit', 'stop_loss', 'manual', 'guard_exit');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('buy', 'sell');

-- CreateEnum
CREATE TYPE "SignalSource" AS ENUM ('sniper', 'scout', 'arbiter', 'manual', 'admin_rule');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "exportPassphraseHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "network" "NetworkMode" NOT NULL DEFAULT 'testnet',
    "address" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "tradeSizeNative" TEXT NOT NULL DEFAULT '0.05',
    "encCiphertext" TEXT NOT NULL,
    "encAuthTag" TEXT NOT NULL,
    "encIv" TEXT NOT NULL,
    "encWrappedDataKey" TEXT NOT NULL,
    "encWrapIv" TEXT NOT NULL,
    "encWrapAuthTag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "source" "SignalSource" NOT NULL,
    "status" "PositionStatus" NOT NULL DEFAULT 'open',
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "sizeAmountIn" TEXT NOT NULL,
    "takeProfitPrice" DOUBLE PRECISION NOT NULL,
    "stopLossPrice" DOUBLE PRECISION NOT NULL,
    "exitPrice" DOUBLE PRECISION,
    "exitReason" "ExitReason",
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "txHash" TEXT NOT NULL,
    "amountIn" TEXT NOT NULL,
    "amountOut" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "feeAmount" TEXT NOT NULL DEFAULT '0',
    "profitAmount" TEXT NOT NULL DEFAULT '0',
    "profitable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_ledger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "amount" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist" (
    "id" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_checks" (
    "id" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "score" INTEGER NOT NULL,
    "checks" JSONB NOT NULL,
    "reasons" JSONB NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ruleVersion" TEXT NOT NULL DEFAULT 'v1',
    "aiPromptVersion" TEXT,

    CONSTRAINT "safety_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "condition" JSONB NOT NULL,
    "action" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_executions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT,
    "status" TEXT NOT NULL,
    "details" JSONB,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegramId_key" ON "users"("telegramId");

-- CreateIndex
CREATE INDEX "wallets_address_idx" ON "wallets"("address");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_chain_network_key" ON "wallets"("userId", "chain", "network");

-- CreateIndex
CREATE INDEX "positions_userId_status_idx" ON "positions"("userId", "status");

-- CreateIndex
CREATE INDEX "positions_chain_tokenAddress_idx" ON "positions"("chain", "tokenAddress");

-- CreateIndex
CREATE INDEX "trades_positionId_idx" ON "trades"("positionId");

-- CreateIndex
CREATE UNIQUE INDEX "fee_ledger_tradeId_key" ON "fee_ledger"("tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_chain_address_key" ON "watchlist"("chain", "address");

-- CreateIndex
CREATE UNIQUE INDEX "safety_checks_chain_tokenAddress_key" ON "safety_checks"("chain", "tokenAddress");

-- CreateIndex
CREATE INDEX "rule_executions_ruleId_idx" ON "rule_executions"("ruleId");

-- CreateIndex
CREATE INDEX "rule_executions_userId_idx" ON "rule_executions"("userId");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_ledger" ADD CONSTRAINT "fee_ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_ledger" ADD CONSTRAINT "fee_ledger_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
