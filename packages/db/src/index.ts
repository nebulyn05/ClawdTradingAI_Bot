import { PrismaClient, Prisma } from "@prisma/client";

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
  AdminRole,
} from "@prisma/client";

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
  AdminRole,
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
