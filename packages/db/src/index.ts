import {
  PrismaClient,
  Prisma,
} from "../generated/index.js";

import type {
  User,
  Wallet,
  Position,
  Trade,
  FeeLedger,
  Watchlist,
  SafetyCheck,
  Setting,
  Rule,
  RuleExecution,
  NudgeMessage,
  KeyAccessLog,
  AdminUser,
  AdminAuditLog,
} from "../generated/index.js";

export {
  PrismaClient,
  Prisma,
};

export type {
  User,
  Wallet,
  Position,
  Trade,
  FeeLedger,
  Watchlist,
  SafetyCheck,
  Setting,
  Rule,
  RuleExecution,
  NudgeMessage,
  KeyAccessLog,
  AdminUser,
  AdminAuditLog,
};

let client: PrismaClient | undefined;

/**
 * Process-wide Prisma client singleton.
 * Prevents multiple Prisma clients from being created during
 * development/hot-reload and worker initialization.
 */
export function getDb(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }

  return client;
}
