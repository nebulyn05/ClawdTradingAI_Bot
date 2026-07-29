import { getDb } from "@clawd/db";
import { createLogger } from "./logger.js";

const log = createLogger("core:settings");

/**
 * Runtime-tunable overrides, backed by the Setting table — this is how the
 * admin dashboard changes trading parameters (TP/SL %, fee rate, concurrency
 * cap, per-specialist enable/disable) without restarting the bot/worker
 * processes. Every getter here falls back to the caller-supplied default
 * (normally the env-configured value from loadConfig()) when no override is
 * stored or the DB read fails — a runtime setting is an optional override,
 * never a hard requirement.
 */
export async function getSetting(key: string): Promise<string | null> {
  try {
    const row = await getDb().setting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch (err) {
    log.warn({ err, key }, "Failed to read runtime setting — falling back to default");
    return null;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  await getDb().setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const raw = await getSetting(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getBooleanSetting(key: string, fallback: boolean): Promise<boolean> {
  const raw = await getSetting(key);
  if (raw === null) return fallback;
  return raw === "true" || raw === "1";
}
