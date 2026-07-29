"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@clawd/db";
import { setSetting, type Chain, type RuleCondition, type RuleAction } from "@clawd/core";
import { openPosition, closePosition } from "@clawd/router";
import { requireAdminSession, attemptLogin, logout } from "./auth";

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
  await requireAdminSession();
  await getDb().wallet.update({ where: { id: walletId }, data: { active } });
  revalidatePath("/users");
}

export async function forceClosePositionAction(positionId: string) {
  await requireAdminSession();
  await closePosition(positionId, "manual");
  revalidatePath("/positions");
}

export async function manualTradeAction(formData: FormData) {
  await requireAdminSession();
  const userId = String(formData.get("userId") ?? "");
  const chain = String(formData.get("chain") ?? "") as Chain;
  const tokenAddress = String(formData.get("tokenAddress") ?? "");
  const sizeNative = String(formData.get("sizeNative") ?? "").trim();

  await openPosition(userId, chain, tokenAddress, "manual", sizeNative || undefined);
  revalidatePath("/positions");
  revalidatePath("/trade");
}

export async function updateSettingAction(key: string, value: string) {
  await requireAdminSession();
  if (value.trim() === "") {
    await getDb().setting.deleteMany({ where: { key } });
  } else {
    await setSetting(key, value.trim());
  }
  revalidatePath("/settings");
}

export async function createRuleAction(formData: FormData) {
  await requireAdminSession();
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

  await getDb().rule.create({
    data: { name, condition: condition as object, action: action as object },
  });
  revalidatePath("/rules");
}

export async function toggleRuleAction(ruleId: string, active: boolean) {
  await requireAdminSession();
  await getDb().rule.update({ where: { id: ruleId }, data: { active } });
  revalidatePath("/rules");
}
