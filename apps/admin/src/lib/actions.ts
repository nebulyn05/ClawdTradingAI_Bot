"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, type AdminRole } from "@clawd/db";
import { setSetting, type Chain, type RuleCondition, type RuleAction } from "@clawd/core";
import { parseNativeAmount } from "@clawd/chains";
import { openPosition, closePosition } from "@clawd/router";
import { exportRawKey } from "@clawd/wallet";
import { requireAdminSession, attemptLogin, logout, logAdminAction, hashAdminPassword } from "./auth";

export async function loginFormAction(formData: FormData) {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await attemptLogin(username, password);
  if (!result.ok) {
    redirect(`/login?error=${encodeURIComponent(result.error ?? "Login failed")}`);
  }
  redirect("/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

export async function setWalletActiveAction(walletId: string, active: boolean) {
  const session = await requireAdminSession("operator");
  await getDb().wallet.update({ where: { id: walletId }, data: { active } });
  await logAdminAction(session, active ? "wallet.activate" : "wallet.pause", { type: "wallet", id: walletId });
  revalidatePath("/users");
}

const LANGUAGE_CODES = ["en", "zh", "tr", "de", "id", "fr", "pt", "ko", "es"] as const;

/** "50" -> 0.5 (the field's stored fraction, same convention as takeProfitPctOverride/stopLossPctOverride), "" -> null ("Auto"). */
function parsePercentInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) throw new Error(`"${raw}" isn't a valid percentage.`);
  return n / 100;
}

/** "1.5" -> 150 (basis points, same convention as Wallet.slippageBuyBps/slippageSellBps), "" -> null ("Auto"). */
function parseSlippagePctInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`"${raw}" isn't a valid slippage percentage (0-100).`);
  return Math.round(n * 100);
}

/**
 * Edits the same per-user trading overrides the bot's own Settings menu
 * exposes (apps/bot/src/menu.ts / wallet-service.ts's updateUserSettings) —
 * mirrored here directly since the admin app talks to Postgres itself rather
 * than through the bot process. Operator-level, same as wallet pause/deploy.
 */
export async function updateUserSettingsAction(userId: string, formData: FormData) {
  const session = await requireAdminSession("operator");
  const languageCode = String(formData.get("languageCode") ?? "");
  if (!LANGUAGE_CODES.includes(languageCode as (typeof LANGUAGE_CODES)[number])) {
    throw new Error(`"${languageCode}" isn't a supported language code.`);
  }

  const data = {
    takeProfitPctOverride: parsePercentInput(String(formData.get("takeProfitPct") ?? "")),
    stopLossPctOverride: parsePercentInput(String(formData.get("stopLossPct") ?? "")),
    ruggGuardEnabled: formData.get("ruggGuardEnabled") === "on",
    antiMevEnabled: formData.get("antiMevEnabled") === "on",
    alertsEnabled: formData.get("alertsEnabled") === "on",
    languageCode,
  };

  await getDb().user.update({ where: { id: userId }, data });
  await logAdminAction(session, "user.settings_update", { type: "user", id: userId }, data);
  revalidatePath(`/users/${userId}`);
}

/** Resets every per-user and per-chain override back to "Auto"/defaults — mirrors the bot's own resetUserSettings exactly (languageCode is deliberately untouched, same as there). */
export async function resetUserSettingsAction(userId: string) {
  const session = await requireAdminSession("operator");
  const db = getDb();
  await db.user.update({
    where: { id: userId },
    data: {
      takeProfitPctOverride: null,
      stopLossPctOverride: null,
      ruggGuardEnabled: true,
      antiMevEnabled: true,
      alertsEnabled: true,
    },
  });
  await db.wallet.updateMany({
    where: { userId },
    data: { buyAmountOverride: null, slippageBuyBps: null, slippageSellBps: null },
  });
  await logAdminAction(session, "user.settings_reset", { type: "user", id: userId });
  revalidatePath(`/users/${userId}`);
}

/** Per-wallet trading overrides (buy amount, slippage) — the same fields Wallet ▸ Transfer's bot-side flows edit, exposed here per chain. */
export async function updateWalletOverridesAction(walletId: string, formData: FormData) {
  const session = await requireAdminSession("operator");
  const db = getDb();
  const wallet = await db.wallet.findUniqueOrThrow({ where: { id: walletId } });

  const rawBuyAmount = String(formData.get("buyAmountOverride") ?? "").trim();
  let buyAmountOverride: string | null = null;
  if (rawBuyAmount !== "") {
    parseNativeAmount(wallet.chain, rawBuyAmount); // throws a friendly error on an invalid amount
    buyAmountOverride = rawBuyAmount;
  }

  const data = {
    buyAmountOverride,
    slippageBuyBps: parseSlippagePctInput(String(formData.get("slippageBuyPct") ?? "")),
    slippageSellBps: parseSlippagePctInput(String(formData.get("slippageSellPct") ?? "")),
  };

  await db.wallet.update({ where: { id: walletId }, data });
  await logAdminAction(session, "wallet.overrides_update", { type: "wallet", id: walletId }, { chain: wallet.chain, ...data });
  revalidatePath(`/users/${wallet.userId}`);
}

export async function forceClosePositionAction(positionId: string) {
  const session = await requireAdminSession("operator");
  await closePosition(positionId, "manual");
  await logAdminAction(session, "position.force_close", { type: "position", id: positionId });
  revalidatePath("/positions");
}

export async function manualTradeAction(formData: FormData) {
  const session = await requireAdminSession("operator");
  const userIds = formData.getAll("userIds").map(String).filter(Boolean);
  const chain = String(formData.get("chain") ?? "") as Chain;
  const tokenAddress = String(formData.get("tokenAddress") ?? "");
  const sizeNative = String(formData.get("sizeNative") ?? "").trim();

  // Fired independently per user (same fan-out shape handleTradeCandidate uses for a real
  // signal) — one user's duplicate-position/concurrency-cap rejection doesn't block the rest.
  const results = await Promise.allSettled(
    userIds.map((userId) => openPosition(userId, chain, tokenAddress, "manual", sizeNative || undefined)),
  );
  const failed = results.filter((r) => r.status === "rejected").length;

  await logAdminAction(
    session,
    "position.manual_open",
    { type: "trade", id: tokenAddress },
    { chain, tokenAddress, sizeNative, userIds, succeeded: userIds.length - failed, failed },
  );
  revalidatePath("/positions");
  revalidatePath("/trade");
}

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * On-chain destination addresses (treasury fee-sweep, stablecoin token
 * addresses) get their format checked before saving — the sweep/lookup code
 * already fails safe on a bad address (caught, logged, funds stay put), but
 * that failure is silent and only surfaces in a log line, so an admin typo
 * could go unnoticed indefinitely. Rejecting an obviously malformed value at
 * save time surfaces the mistake immediately instead.
 */
function validateAddressSetting(key: string, value: string): string | null {
  const isTreasuryOrStablecoin = /^(TREASURY_ADDRESS_|STABLECOIN_(USDC|USDT)_ADDRESS_)/.test(key);
  if (!isTreasuryOrStablecoin) return null;
  const isSolana = key.endsWith("_SOLANA");
  const pattern = isSolana ? SOLANA_ADDRESS_RE : EVM_ADDRESS_RE;
  if (!pattern.test(value)) {
    return isSolana
      ? "Not a valid Solana address (expected base58, 32-44 characters)."
      : "Not a valid EVM address (expected 0x followed by 40 hex characters).";
  }
  return null;
}

export async function updateSettingAction(key: string, value: string) {
  const session = await requireAdminSession("operator");
  const trimmed = value.trim();
  if (trimmed === "") {
    await getDb().setting.deleteMany({ where: { key } });
  } else {
    const addressError = validateAddressSetting(key, trimmed);
    if (addressError) throw new Error(addressError);
    await setSetting(key, trimmed);
  }
  await logAdminAction(session, "setting.update", { type: "setting", id: key }, { value: trimmed || null });
  revalidatePath("/settings");
}

export async function createRuleAction(formData: FormData) {
  const session = await requireAdminSession("operator");
  const name = String(formData.get("name") ?? "").trim();
  const conditionChain = String(formData.get("conditionChain") ?? "") as Chain;
  const conditionAmount = String(formData.get("conditionAmount") ?? "").trim();
  const actionChain = String(formData.get("actionChain") ?? "") as Chain;
  const actionToken = String(formData.get("actionToken") ?? "").trim();
  const actionSize = String(formData.get("actionSize") ?? "").trim();

  if (!name || !conditionChain || !conditionAmount || !actionChain || !actionToken || !actionSize) {
    return;
  }

  const condition: RuleCondition = {
    type: "profitAbove",
    chain: conditionChain,
    amountNative: conditionAmount,
  };
  const action: RuleAction = {
    type: "buy",
    chain: actionChain,
    tokenAddress: actionToken,
    sizeNative: actionSize,
  };

  const rule = await getDb().rule.create({
    data: { name, condition: condition as object, action: action as object },
  });
  await logAdminAction(session, "rule.create", { type: "rule", id: rule.id }, { name });
  revalidatePath("/rules");
}

export async function toggleRuleAction(ruleId: string, active: boolean) {
  const session = await requireAdminSession("operator");
  await getDb().rule.update({ where: { id: ruleId }, data: { active } });
  await logAdminAction(session, active ? "rule.enable" : "rule.disable", { type: "rule", id: ruleId });
  revalidatePath("/rules");
}

export async function createNudgeMessageAction(formData: FormData) {
  const session = await requireAdminSession("operator");
  const content = String(formData.get("content") ?? "").trim();
  const order = Number(formData.get("order") ?? 0);
  if (!content) return;

  const message = await getDb().nudgeMessage.create({ data: { content, order } });
  await logAdminAction(session, "nudge.create", { type: "nudge", id: message.id }, { order });
  revalidatePath("/nudges");
}

export async function toggleNudgeMessageAction(messageId: string, active: boolean) {
  const session = await requireAdminSession("operator");
  await getDb().nudgeMessage.update({ where: { id: messageId }, data: { active } });
  await logAdminAction(session, active ? "nudge.enable" : "nudge.disable", { type: "nudge", id: messageId });
  revalidatePath("/nudges");
}

/**
 * Queues an immediate send rather than fanning out Promise.allSettled calls
 * like manualTradeAction — there's no per-user chain call to parallelize
 * here, just a Postgres write. The bot process's own already-scheduled
 * reengagement check (apps/bot/src/reengagement.ts) picks up and clears
 * pendingManualNudgeMessageId on its next tick and does the actual Telegram
 * send, since only the bot process holds a live Bot/API client.
 */
export async function manualNudgeAction(formData: FormData) {
  const session = await requireAdminSession("operator");
  const userIds = formData.getAll("userIds").map(String).filter(Boolean);
  const messageId = String(formData.get("messageId") ?? "");
  if (userIds.length === 0 || !messageId) return;

  const { count } = await getDb().user.updateMany({
    where: { id: { in: userIds } },
    data: { pendingManualNudgeMessageId: messageId },
  });
  await logAdminAction(session, "nudge.manual_send", { type: "nudge", id: messageId }, { userIds, queued: count });
  revalidatePath("/nudges");
}

/**
 * Decrypts and returns a user's raw wallet private key for the admin
 * dashboard. This bypasses the bot's normal passphrase-gated /export flow —
 * every call is written to KeyAccessLog first, so a reveal is never silent.
 * super_admin only: this is the single most sensitive action in the app.
 */
export async function revealPrivateKeyAction(
  walletId: string,
): Promise<{ chain: string; address: string; rawKey: string }> {
  const session = await requireAdminSession("super_admin");
  const db = getDb();
  const wallet = await db.wallet.findUniqueOrThrow({ where: { id: walletId } });

  await db.keyAccessLog.create({
    data: { walletId: wallet.id, userId: wallet.userId, chain: wallet.chain, adminUsername: session.username },
  });
  await logAdminAction(session, "wallet.key_reveal", { type: "wallet", id: walletId }, { chain: wallet.chain });

  const rawKey = exportRawKey({
    ciphertext: wallet.encCiphertext,
    authTag: wallet.encAuthTag,
    iv: wallet.encIv,
    wrappedDataKey: wallet.encWrappedDataKey,
    wrapIv: wallet.encWrapIv,
    wrapAuthTag: wallet.encWrapAuthTag,
  });

  revalidatePath("/audit-log");
  return { chain: wallet.chain, address: wallet.address, rawKey };
}

/**
 * Permanently deletes a user and everything that cascades from them
 * (wallets, positions, trades, fee ledger entries — see schema.prisma's
 * onDelete: Cascade relations). KeyAccessLog rows reference the user only by
 * plain string id, not a foreign key, so they deliberately survive this.
 * super_admin only.
 */
export async function deleteUserAction(userId: string) {
  const session = await requireAdminSession("super_admin");
  await getDb().user.delete({ where: { id: userId } });
  await logAdminAction(session, "user.delete", { type: "user", id: userId });
  revalidatePath("/users");
}

// --- Admin account management (super_admin only) ---

export async function createAdminAction(formData: FormData) {
  const session = await requireAdminSession("super_admin");
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "analyst") as AdminRole;

  if (!username || password.length < 8) return;

  const passwordHash = await hashAdminPassword(password);
  const created = await getDb().adminUser.create({ data: { username, passwordHash, role } });
  await logAdminAction(session, "admin.create", { type: "admin_user", id: created.id }, { username, role });
  revalidatePath("/admins");
}

export async function updateAdminRoleAction(formData: FormData) {
  const session = await requireAdminSession("super_admin");
  const adminUserId = String(formData.get("adminUserId") ?? "");
  const role = String(formData.get("role") ?? "") as AdminRole;
  if (!adminUserId || !["super_admin", "operator", "analyst"].includes(role)) return;

  const target = await getDb().adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
  if (target.username === session.username && role !== "super_admin") {
    throw new Error("You can't demote your own account away from super_admin.");
  }

  await getDb().adminUser.update({ where: { id: adminUserId }, data: { role } });
  await logAdminAction(session, "admin.role_change", { type: "admin_user", id: adminUserId }, { role });
  revalidatePath("/admins");
}

export async function setAdminActiveAction(adminUserId: string, active: boolean) {
  const session = await requireAdminSession("super_admin");
  const target = await getDb().adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
  if (target.username === session.username) {
    throw new Error("You can't deactivate your own account.");
  }
  await getDb().adminUser.update({ where: { id: adminUserId }, data: { active } });
  await logAdminAction(session, active ? "admin.activate" : "admin.deactivate", { type: "admin_user", id: adminUserId });
  revalidatePath("/admins");
}

export async function resetAdminPasswordAction(formData: FormData) {
  const session = await requireAdminSession("super_admin");
  const adminUserId = String(formData.get("adminUserId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!adminUserId || password.length < 8) return;

  const passwordHash = await hashAdminPassword(password);
  await getDb().adminUser.update({ where: { id: adminUserId }, data: { passwordHash } });
  await logAdminAction(session, "admin.password_reset", { type: "admin_user", id: adminUserId });
  revalidatePath("/admins");
}
