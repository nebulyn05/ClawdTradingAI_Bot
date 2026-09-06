-- CreateTable
CREATE TABLE "key_access_logs" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "adminUsername" TEXT NOT NULL,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "key_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "key_access_logs_walletId_idx" ON "key_access_logs"("walletId");

-- CreateIndex
CREATE INDEX "key_access_logs_userId_idx" ON "key_access_logs"("userId");

