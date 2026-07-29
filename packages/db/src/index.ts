import { PrismaClient } from "../generated/index.js";

export * from "../generated/index.js";

let client: PrismaClient | undefined;

/** Process-wide Prisma client singleton (avoids exhausting DB connections on hot reload). */
export function getDb(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}
