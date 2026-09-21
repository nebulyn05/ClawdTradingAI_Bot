import { createLogger } from "@clawd/core";
import { getDb } from "@clawd/db";
import type { ResearchSignalDecision, ResearchStrategy } from "@prisma/client";

const log = createLogger("research:paper-executor");

const PAPER_MAX_POSITION_USD = Number(process.env.PAPER_MAX_POSITION_USD ?? "10");
const PAPER_FEE_BPS = Number(process.env.PAPER_FEE_BPS ?? "10");
const PAPER_SLIPPAGE_BPS = Number(process.env.PAPER_SLIPPAGE_BPS ?? "50");

function validPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export async function executePaperSignal(input: {
  opportunityId: string;
  strategy: ResearchStrategy;
  decision: ResearchSignalDecision;
  chain: "solana" | "ethereum" | "bsc" | "base" | "monad" | "robinhood";
  tokenAddress: string;
  priceUsd?: number | null;
  generatedAt: Date;
}): Promise<void> {
  if (input.decision !== "BUY") return;
  if (!validPositive(input.priceUsd ?? 0)) return;
  if (!validPositive(PAPER_MAX_POSITION_USD)) {
    log.warn({ strategy: input.strategy }, "Paper BUY skipped: PAPER_MAX_POSITION_USD is not positive");
    return;
  }

  const db = getDb();
  const existing = await db.researchPaperPosition.findFirst({
    where: {
      opportunityId: input.opportunityId,
      strategy: input.strategy,
    },
    select: { id: true },
  });
  if (existing) return;

  const priceUsd = input.priceUsd!;
  const notionalUsd = PAPER_MAX_POSITION_USD;
  const feeUsd = notionalUsd * PAPER_FEE_BPS / 10_000;
  const slippagePct = PAPER_SLIPPAGE_BPS / 10_000;
  const fillPrice = priceUsd * (1 + slippagePct);
  const quantity = (notionalUsd - feeUsd) / fillPrice;

  if (!validPositive(quantity)) return;

  await db.$transaction(async (tx) => {
    const duplicate = await tx.researchPaperPosition.findFirst({
      where: {
        opportunityId: input.opportunityId,
        strategy: input.strategy,
      },
      select: { id: true },
    });
    if (duplicate) return;

    const position = await tx.researchPaperPosition.create({
      data: {
        opportunityId: input.opportunityId,
        strategy: input.strategy,
        chain: input.chain,
        tokenAddress: input.tokenAddress,
        entryPriceUsd: fillPrice,
        quantity,
        investedUsd: notionalUsd,
        openedAt: input.generatedAt,
        currentPriceUsd: priceUsd,
        status: "open",
      },
    });

    await tx.researchPaperTrade.create({
      data: {
        positionId: position.id,
        side: "buy",
        priceUsd: fillPrice,
        quantity,
        notionalUsd,
        feeUsd,
        slippagePct: slippagePct * 100,
        createdAt: input.generatedAt,
      },
    });
  });

  log.info(
    {
      opportunityId: input.opportunityId,
      strategy: input.strategy,
      tokenAddress: input.tokenAddress,
      entryPriceUsd: fillPrice,
      investedUsd: notionalUsd,
    },
    "Paper BUY executed",
  );
}
