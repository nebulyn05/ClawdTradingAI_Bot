import { getDb } from "@clawd/db";
import {
  createLogger,
  networkForChain,
  type Chain,
  type RuleCondition,
  type RuleAction,
} from "@clawd/core";
import { getChainAdapter, parseNativeAmount } from "@clawd/chains";
import { openPosition } from "./open.js";

const log = createLogger("router:rules-engine");

let evaluationRunning = false;

async function userProfitOnChain(userId: string, chain: Chain): Promise<bigint> {
  const trades = await getDb().trade.findMany({
    where: { side: "sell", position: { userId, chain } },
    select: { profitAmount: true },
  });
  return trades.reduce((sum, trade) => sum + BigInt(trade.profitAmount), 0n);
}

async function nativeBalance(userId: string, chain: Chain): Promise<bigint | null> {
  const db = getDb();
  const wallet = await db.wallet.findUnique({
    where: {
      userId_chain_network: {
        userId,
        chain,
        network: networkForChain(chain),
      },
    },
    select: { address: true, active: true },
  });

  if (!wallet) return null;

  const adapter = getChainAdapter(chain);
  if (!adapter.enabled) return null;

  try {
    return await adapter.getBalance(wallet.address);
  } catch (err) {
    log.warn({ err, userId, chain }, "Failed to read wallet balance for rule condition");
    return null;
  }
}

async function conditionMet(
  userId: string,
  userCreatedAt: Date,
  ruleCreatedAt: Date,
  condition: RuleCondition,
): Promise<boolean> {
  switch (condition.type) {
    case "always":
      return true;

    case "newUser":
      return userCreatedAt >= ruleCreatedAt;

    case "profitAbove": {
      const profit = await userProfitOnChain(userId, condition.chain);
      return profit > parseNativeAmount(condition.chain, condition.amountNative);
    }

    case "profitBelow": {
      const profit = await userProfitOnChain(userId, condition.chain);
      return profit < parseNativeAmount(condition.chain, condition.amountNative);
    }

    case "nativeBalanceAbove": {
      const balance = await nativeBalance(userId, condition.chain);
      if (balance === null) return false;
      return balance > parseNativeAmount(condition.chain, condition.amountNative);
    }

    case "nativeBalanceBelow": {
      const balance = await nativeBalance(userId, condition.chain);
      if (balance === null) return false;
      return balance < parseNativeAmount(condition.chain, condition.amountNative);
    }

    case "and":
      for (const child of condition.conditions) {
        if (!(await conditionMet(userId, userCreatedAt, ruleCreatedAt, child))) return false;
      }
      return true;

    case "or":
      for (const child of condition.conditions) {
        if (await conditionMet(userId, userCreatedAt, ruleCreatedAt, child)) return true;
      }
      return false;

    default:
      return false;
  }
}

function executionMode(action: RuleAction): "once" | "recurring" {
  return action.mode === "recurring" ? "recurring" : "once";
}

async function mayExecute(
  ruleId: string,
  userId: string,
  action: RuleAction,
): Promise<boolean> {
  const executions = await getDb().ruleExecution.findMany({
    where: { ruleId, userId, status: "opened" },
    orderBy: { triggeredAt: "desc" },
    take: 1,
    select: { triggeredAt: true },
  });

  const last = executions[0];
  if (!last) return true;

  if (executionMode(action) === "once") return false;

  const cooldownMinutes = Math.max(1, action.cooldownMinutes ?? 1440);
  return Date.now() - last.triggeredAt.getTime() >= cooldownMinutes * 60_000;
}

async function runAction(
  userId: string,
  ruleId: string,
  action: RuleAction,
): Promise<void> {
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
            details: {
              action: action.type,
              chain: action.chain,
              tokenAddress: action.tokenAddress,
              sizeNative: action.sizeNative,
              mode: executionMode(action),
            },
          },
        });

        if (!position) {
          log.info({ ruleId, userId }, "Rule matched but Router skipped the trade");
        }
      } catch (err) {
        log.error({ err, userId, ruleId }, "Rule action failed");
        await db.ruleExecution.create({
          data: {
            ruleId,
            userId,
            status: "failed",
            details: { error: String(err), action: action.type },
          },
        });
      }
    }
  }
}

/**
 * Evaluates active automation rules against users.
 *
 * Supported conditions:
 * - always
 * - newUser
 * - native balance above/below a threshold
 * - realized profit above/below a threshold
 * - AND/OR combinations of the above
 *
 * Supported action:
 * - buy a token with a fixed native amount
 *
 * Actions are routed through the normal Router, so wallet activation,
 * duplicate-position checks, exposure limits, circuit breaker and the real
 * chain adapter are all still enforced.
 *
 * By default a rule fires once per user. Set action.mode="recurring" and a
 * cooldownMinutes value to allow repeated trades while the condition remains
 * true.
 */
export async function evaluateRules(): Promise<void> {
  if (evaluationRunning) {
    log.warn("Skipping rule tick because the previous evaluation is still running");
    return;
  }

  evaluationRunning = true;
  try {
    const db = getDb();
    const rules = await db.rule.findMany({
      where: { active: true },
      orderBy: { createdAt: "asc" },
    });
    if (rules.length === 0) return;

    const users = await db.user.findMany({
      select: { id: true, createdAt: true },
    });

    for (const rule of rules) {
      const condition = rule.condition as unknown as RuleCondition;
      const action = rule.action as unknown as RuleAction;

      for (const user of users) {
        try {
          if (!(await mayExecute(rule.id, user.id, action))) continue;
          if (!(await conditionMet(user.id, user.createdAt, rule.createdAt, condition))) continue;

          log.info({ ruleId: rule.id, userId: user.id }, "Automation rule matched");
          await runAction(user.id, rule.id, action);
        } catch (err) {
          log.warn({ err, ruleId: rule.id, userId: user.id }, "Failed to evaluate rule for user");
        }
      }
    }
  } finally {
    evaluationRunning = false;
  }
}

/** Starts the worker's recurring automation evaluation loop. */
export function startRuleEngine(intervalMs: number): () => void {
  void evaluateRules().catch((err) => log.error({ err }, "Initial rule evaluation failed"));

  const timer = setInterval(() => {
    void evaluateRules().catch((err) => log.error({ err }, "Rule engine tick failed"));
  }, intervalMs);

  return () => clearInterval(timer);
}
