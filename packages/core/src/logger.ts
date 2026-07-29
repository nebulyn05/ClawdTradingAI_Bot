import pino from "pino";
import { loadConfig } from "./config.js";

let root: pino.Logger | undefined;

function rootLogger(): pino.Logger {
  if (!root) {
    const { LOG_LEVEL, NODE_ENV } = loadConfig();
    root = pino({
      level: LOG_LEVEL,
      transport:
        NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
      redact: ["*.privateKey", "*.encryptedKey", "*.rawKey", "*.passphrase"],
    });
  }
  return root;
}

/** Creates a child logger scoped to a module/service name, e.g. createLogger("sniper:solana"). */
export function createLogger(scope: string): pino.Logger {
  return rootLogger().child({ scope });
}
