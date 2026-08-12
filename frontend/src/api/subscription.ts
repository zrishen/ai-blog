import { API_BASE, apiFetch, assertOk, parseJson } from "./client";

// 对接后端 /api/v1/subscription/*（status 含周配额，redeem 激活兑换码）。

export interface SubscriptionStatus {
  active: boolean;
  expires_at: string | null;
  period: string | null;
  used: number;
  limit: number;
  remaining: number;
}

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const res = await apiFetch(`${API_BASE}/subscription/status`);
  await assertOk(res, "读取订阅状态失败");
  return parseJson<SubscriptionStatus>(res);
}

export async function redeemSubscriptionCode(code: string): Promise<SubscriptionStatus> {
  const res = await apiFetch(`${API_BASE}/subscription/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  await assertOk(res, "兑换失败");
  return parseJson<SubscriptionStatus>(res);
}
