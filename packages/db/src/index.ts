import {
  PrismaClient,
  Prisma,
} from "../generated/index.js";

import type {
  Wallet,
  User,
  Position,
  Trade,
  SafetyCheck,
  Rule,
  RuleExecution,
  Setting,
  Watchlist,
  NudgeMessage,
  KeyAccessLog,
  AdminUser,
  AdminAuditLog,
  FeeLedger,
} from "../generated/index.js";

export {
  PrismaClient,
  Prisma,
};

export type {
  Wallet,
  User,
  Position,
  Trade,
  SafetyCheck,
  Rule,
  RuleExecution,
  Setting,
  Watchlist,
  NudgeMessage,
  KeyAccessLog,
  AdminUser,
  AdminAuditLog,
  FeeLedger,
};

let client: PrismaClient | undefined;

/**
 * Process-wide Prisma client singleton.
 * Avoids exhausting database connections on hot reload.
 */
export function getDb(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }

  return client;
}
