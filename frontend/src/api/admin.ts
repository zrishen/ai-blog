import { API_BASE, apiFetch, readErrorDetail } from "./client";

// ============ Admin API ============
// 对接后端 /api/v1/admin/*（全部 require_admin，403 由调用方处理）。
// 端点清单见 backend/src/api/admin*.py。

// ---- 守卫 ----
export async function adminPing(): Promise<boolean> {
  const res = await apiFetch(`${API_BASE}/admin/ping`);
  return res.ok;
}

// ---- 概览 / 用量（/admin/usage）----
export interface AdminOverview {
  total_users: number;
  active_subscriptions: number;
  codes_total: number;
  codes_used: number;
  this_week_tokens: number;
}

export interface AdminUserWeeklyUsage {
  user_id: number;
  username: string;
  active: boolean;
  period: string;
  used: number;
  limit: number;
  remaining: number;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const res = await apiFetch(`${API_BASE}/admin/usage/overview`);
  if (!res.ok) throw new Error(await readErrorDetail(res, "读取概览失败"));
  return res.json();
}

export async function getAdminUserUsage(userId: number): Promise<AdminUserWeeklyUsage> {
  const res = await apiFetch(`${API_BASE}/admin/usage/user/${userId}`);
  if (!res.ok) throw new Error(await readErrorDetail(res, "读取用户用量失败"));
  return res.json();
}

// ---- 用户（/admin/users）----
export interface AdminUserItem {
  id: number;
  username: string;
  is_admin: boolean;
  is_super_admin: boolean;
  subscription_expires_at: string | null;
  created_at: string | null;
}

export interface AdminListUsersResponse {
  items: AdminUserItem[];
  total: number;
  offset: number;
  limit: number;
}

export async function listAdminUsers(params?: {
  search?: string;
  offset?: number;
  limit?: number;
}): Promise<AdminListUsersResponse> {
  const q = new URLSearchParams();
  if (params?.search) q.set("search", params.search);
  if (params?.offset != null) q.set("offset", String(params.offset));
  if (params?.limit != null) q.set("limit", String(params.limit));
  const query = q.toString();
  const res = await apiFetch(`${API_BASE}/admin/users${query ? "?" + query : ""}`);
  if (!res.ok) throw new Error(await readErrorDetail(res, "读取用户列表失败"));
  return res.json();
}

export async function grantAdminSubscription(
  userId: number,
  days: number,
): Promise<{ subscription_expires_at: string }> {
  const res = await apiFetch(`${API_BASE}/admin/users/${userId}/subscription/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days }),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res, "延期订阅失败"));
  return res.json();
}

export async function setAdminUser(userId: number, isAdmin: boolean): Promise<AdminUserItem> {
  const res = await apiFetch(`${API_BASE}/admin/users/${userId}/admin`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_admin: isAdmin }),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res, "设置管理员失败"));
  return res.json();
}

// ---- 兑换码（/admin/codes）----
export interface AdminCodeItem {
  id: number;
  code: string;
  duration_days: number;
  is_used: boolean;
  used_by_user_id: number | null;
  created_at: string;
  note: string | null;
}

export interface AdminListCodesResponse {
  items: AdminCodeItem[];
  offset: number;
  limit: number;
}

export async function generateAdminCodes(data: {
  count: number;
  duration_days: number;
  note?: string;
}): Promise<{ codes: string[] }> {
  const res = await apiFetch(`${API_BASE}/admin/codes/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await readErrorDetail(res, "生成兑换码失败"));
  return res.json();
}

export async function listAdminCodes(params?: {
  used?: boolean;
  offset?: number;
  limit?: number;
}): Promise<AdminListCodesResponse> {
  const q = new URLSearchParams();
  if (params?.used != null) q.set("used", String(params.used));
  if (params?.offset != null) q.set("offset", String(params.offset));
  if (params?.limit != null) q.set("limit", String(params.limit));
  const query = q.toString();
  const res = await apiFetch(`${API_BASE}/admin/codes/${query ? "?" + query : ""}`);
  if (!res.ok) throw new Error(await readErrorDetail(res, "读取兑换码列表失败"));
  return res.json();
}

export async function revokeAdminCode(codeId: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/admin/codes/${codeId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readErrorDetail(res, "作废兑换码失败"));
  }
}
