-- AlterTable
ALTER TABLE "users" ADD COLUMN     "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "antiMevEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "languageCode" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredByUserId" TEXT,
ADD COLUMN     "ruggGuardEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "stopLossPctOverride" DOUBLE PRECISION,
ADD COLUMN     "takeProfitPctOverride" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "buyAmountOverride" TEXT,
ADD COLUMN     "slippageBuyBps" INTEGER,
ADD COLUMN     "slippageSellBps" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referredByUserId_fkey" FOREIGN KEY ("referredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

