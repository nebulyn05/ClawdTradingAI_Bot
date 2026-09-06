-- CreateTable
CREATE TABLE "nudge_messages" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nudge_messages_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "nudgeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastNudgedAt" TIMESTAMP(3),
ADD COLUMN     "pendingManualNudgeMessageId" TEXT;

-- CreateIndex
CREATE INDEX "users_lastNudgedAt_idx" ON "users"("lastNudgedAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_pendingManualNudgeMessageId_fkey" FOREIGN KEY ("pendingManualNudgeMessageId") REFERENCES "nudge_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
