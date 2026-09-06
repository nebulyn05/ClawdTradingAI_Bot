import { getDb } from "@clawd/db";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildDayLabels(days: number): string[] {
  const labels: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    labels.push(dayKey(d));
  }
  return labels;
}

export interface UserGrowth {
  labels: string[];
  cumulative: number[];
}

/** Cumulative signups per day — the one metric here that's safely combinable across chains (it's just a count). */
export async function getUserGrowth(days = 30): Promise<UserGrowth> {
  const db = getDb();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const [beforeCount, users] = await Promise.all([
    db.user.count({ where: { createdAt: { lt: since } } }),
    db.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
  ]);

  const labels = buildDayLabels(days);
  const perDay = new Map(labels.map((l) => [l, 0]));
  for (const u of users) {
    const k = dayKey(u.createdAt);
    if (perDay.has(k)) perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }

  let running = beforeCount;
  const cumulative = labels.map((l) => (running += perDay.get(l) ?? 0));
  return { labels, cumulative };
}

export interface TradeActivity {
  labels: string[];
  buys: number[];
  sells: number[];
  /** Win rate (0-100) among sell trades each day — a dimensionless ratio, so unlike native-unit PnL/volume it's safe to combine across chains. */
  winRate: number[];
}

/**
 * Trade counts and win rate are used instead of a combined "volume" or "PnL"
 * figure — Trade.amountIn/profitAmount are raw native units per chain
 * (lamports, wei, …) and can't be summed across chains without a price
 * feed at trade time, which isn't stored (see performance.ts's own
 * per-chain-only reasoning). Count and win-rate are both chain-agnostic.
 */
export async function getTradeActivity(days = 30): Promise<TradeActivity> {
  const db = getDb();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const trades = await db.trade.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, side: true, profitable: true },
  });

  const labels = buildDayLabels(days);
  const buys = new Map(labels.map((l) => [l, 0]));
  const sells = new Map(labels.map((l) => [l, 0]));
  const wins = new Map(labels.map((l) => [l, 0]));
  const losses = new Map(labels.map((l) => [l, 0]));

  for (const t of trades) {
    const k = dayKey(t.createdAt);
    if (!buys.has(k)) continue;
    if (t.side === "buy") {
      buys.set(k, (buys.get(k) ?? 0) + 1);
    } else {
      sells.set(k, (sells.get(k) ?? 0) + 1);
      if (t.profitable) wins.set(k, (wins.get(k) ?? 0) + 1);
      else losses.set(k, (losses.get(k) ?? 0) + 1);
    }
  }

  const winRate = labels.map((l) => {
    const w = wins.get(l) ?? 0;
    const total = w + (losses.get(l) ?? 0);
    return total > 0 ? (w / total) * 100 : 0;
  });

  return {
    labels,
    buys: labels.map((l) => buys.get(l) ?? 0),
    sells: labels.map((l) => sells.get(l) ?? 0),
    winRate,
  };
}

export const ACTIVITY_TYPES = ["trade", "rule", "admin", "key_reveal", "signup"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ActivityItem {
  id: string;
  type: ActivityType;
  timestamp: Date;
  summary: string;
  detail?: string;
}

/**
 * Merges every kind of recorded activity — trades, admin rule firings,
 * dashboard admin actions, key reveals, and new signups — into one
 * chronological feed. Each source table already exists for its own reason
 * (Trade for the pipeline, AdminAuditLog/KeyAccessLog for accountability,
 * RuleExecution for the rule engine); this just reads all of them and
 * merge-sorts by time rather than introducing a new "activity" table that
 * would duplicate what's already recorded elsewhere.
 */
export async function getUnifiedActivity(limit = 200): Promise<ActivityItem[]> {
  const db = getDb();
  const perSourceLimit = limit;

  const [trades, rules, adminActions, keyReveals, users] = await Promise.all([
    db.trade.findMany({
      orderBy: { createdAt: "desc" },
      take: perSourceLimit,
      include: { position: { select: { chain: true, tokenAddress: true } } },
    }),
    db.ruleExecution.findMany({
      orderBy: { triggeredAt: "desc" },
      take: perSourceLimit,
      include: { rule: { select: { name: true } } },
    }),
    db.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: perSourceLimit }),
    db.keyAccessLog.findMany({ orderBy: { accessedAt: "desc" }, take: perSourceLimit }),
    db.user.findMany({
      orderBy: { createdAt: "desc" },
      take: perSourceLimit,
      select: { id: true, telegramUsername: true, telegramId: true, createdAt: true },
    }),
  ]);

  const items: ActivityItem[] = [
    ...trades.map((t) => ({
      id: `trade:${t.id}`,
      type: "trade" as const,
      timestamp: t.createdAt,
      summary:
        `${t.side === "buy" ? "🟢 Bought" : "🔴 Sold"} on ${t.position.chain}` +
        (t.side === "sell" ? (t.profitable ? " — profit" : " — loss") : ""),
      detail: `${t.position.tokenAddress.slice(0, 10)}…`,
    })),
    ...rules.map((r) => ({
      id: `rule:${r.id}`,
      type: "rule" as const,
      timestamp: r.triggeredAt,
      summary: `Rule "${r.rule.name}" ${r.status}`,
      detail: r.userId,
    })),
    ...adminActions.map((a) => ({
      id: `admin:${a.id}`,
      type: "admin" as const,
      timestamp: a.createdAt,
      summary: `${a.adminUsername} (${a.adminRole}) — ${a.action}`,
      detail: a.targetType ? `${a.targetType}:${a.targetId}` : undefined,
    })),
    ...keyReveals.map((k) => ({
      id: `key:${k.id}`,
      type: "key_reveal" as const,
      timestamp: k.accessedAt,
      summary: `${k.adminUsername} revealed a ${k.chain} private key`,
      detail: k.userId,
    })),
    ...users.map((u) => ({
      id: `signup:${u.id}`,
      type: "signup" as const,
      timestamp: u.createdAt,
      summary: `New user signed up${u.telegramUsername ? ` (@${u.telegramUsername})` : ""}`,
      detail: u.telegramId,
    })),
  ];

  items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return items.slice(0, limit);
}
