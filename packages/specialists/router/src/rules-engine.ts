import { getDb } from "@clawd/db";
import { createLogger, type Chain, type RuleCondition, type RuleAction } from "@clawd/core";
import { parseNativeAmount } from "@clawd/chains";
import { openPosition } from "./open.js";

const log = createLogger("router:rules-engine");

async function userProfitOnChain(userId: string, chain: Chain): Promise<bigint> {
  const trades = await getDb().trade.findMany({
    where: { side: "sell", position: { userId, chain } },
    select: { profitAmount: true },
  });
  return trades.reduce((sum, t) => sum + BigInt(t.profitAmount), 0n);
}

async function conditionMet(userId: string, condition: RuleCondition): Promise<boolean> {
  switch (condition.type) {
    case "profitAbove": {
      const profit = await userProfitOnChain(userId, condition.chain);
      const threshold = parseNativeAmount(condition.chain, condition.amountNative);
      return profit > threshold;
    }
    default:
      return false;
  }
}

async function runAction(userId: string, ruleId: string, action: RuleAction): Promise<void> {
  const db = getDb();
  switch (action.type) {
    case "buy": {
      try {
        const position = await openPosition(
          userId,
          action.chain,
          action.tokenAddress,
          "admin_rule",
          action.sizeNative,
        );
        await db.ruleExecution.create({
          data: {
            ruleId,
            userId,
            positionId: position?.id,
            status: position ? "opened" : "skipped",
          },
        });
        break;
      } catch (err) {
        log.error({ err, userId, ruleId }, "Rule action failed");
        await db.ruleExecution.create({
          data: { ruleId, userId, status: "failed", details: { error: String(err) } },
        });
        break;
      }
    }
  }
}

/**
 * Evaluates every active Rule against every user. Each (rule, user) pair
 * fires its action at most once — a "RuleExecution.status === 'opened'" row
 * already existing for that pair means it's already fired, so a rule reads
 * as "the first time this condition is true for you," not "every tick it
 * stays true." Admins toggle a Rule's `active` flag to stop it, or create a
 * fresh Rule to re-arm the same condition.
 */
export async function evaluateRules(): Promise<void> {
  const db = getDb();
  const rules = await db.rule.findMany({ where: { active: true } });
  if (rules.length === 0) return;

  const users = await db.user.findMany({ select: { id: true } });

  for (const rule of rules) {
    const condition = rule.condition as unknown as RuleCondition;
    const action = rule.action as unknown as RuleAction;

    for (const user of users) {
      try {
        const alreadyFired = await db.ruleExecution.findFirst({
          where: { ruleId: rule.id, userId: user.id, status: "opened" },
        });
        if (alreadyFired) continue;

        if (!(await conditionMet(user.id, condition))) continue;

        log.info({ ruleId: rule.id, userId: user.id }, "Rule condition met — running action");
        await runAction(user.id, rule.id, action);
      } catch (err) {
        log.warn({ err, ruleId: rule.id, userId: user.id }, "Failed to evaluate rule for user");
      }
    }
  }
}

/** Starts a recurring rule-engine evaluation loop. Returns a function to stop it. */
export function startRuleEngine(intervalMs: number): () => void {
  const timer = setInterval(() => {
    evaluateRules().catch((err) => log.error({ err }, "Rule engine tick failed"));
  }, intervalMs);
  return () => clearInterval(timer);
}
