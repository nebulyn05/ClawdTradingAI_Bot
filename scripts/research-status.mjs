import { PrismaClient } from "@prisma/client";

function sslDatabaseUrl(raw) {
  if (!raw) throw new Error("DATABASE_URL is not set");
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use a PostgreSQL connection URL");
  }
  url.searchParams.set("sslmode", "require");
  return url.toString();
}

const rawUrl = process.env.DATABASE_URL;
const prisma = new PrismaClient({
  datasources: {
    db: { url: sslDatabaseUrl(rawUrl) },
  },
});

try {
  await prisma.$connect();

  const [
    opportunities,
    observations,
    signals,
    positions,
    trades,
    outcomes,
  ] = await Promise.all([
    prisma.researchOpportunity.count(),
    prisma.researchObservation.count(),
    prisma.researchSignal.count(),
    prisma.researchPaperPosition.count(),
    prisma.researchPaperTrade.count(),
    prisma.researchOutcome.count(),
  ]);

  const recent = await prisma.researchOpportunity.findMany({
    orderBy: { launchTime: "desc" },
    take: 10,
    select: {
      id: true,
      tokenAddress: true,
      chain: true,
      dex: true,
      launchTime: true,
      createdAt: true,
    },
  });

  console.log(JSON.stringify({
    database: "connected",
    counts: {
      opportunities,
      observations,
      signals,
      paperPositions: positions,
      paperTrades: trades,
      outcomes,
    },
    recentOpportunities: recent,
  }, null, 2));
} catch (error) {
  console.error("Database diagnostics failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
