const API_BASE = "/api/v1";
const REFRESH_ENDPOINT = `${API_BASE}/auth/refresh`;

// access token 只存内存（不写 localStorage，防 XSS 窃取）；refresh token 在 HttpOnly cookie 里，
// 由浏览器随 /api/v1/auth/* 请求自动携带。authStore 在登录/刷新成功时调用 setAccessToken。
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

function triggerLogout(): void {
  setAccessToken(null);
  window.dispatchEvent(new Event("auth:logout"));
}

// 单飞 refresh：并发多个请求同时 401 时只发一次 /auth/refresh，复用同一 promise，避免雪崩。
let refreshPromise: Promise<string | null> | null = null;

// refresh 超时：端点 hang 住时避免单飞 promise 永不 settle、所有排队 401 请求随之挂起
const REFRESH_TIMEOUT_MS = 10_000;

async function doRefresh(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  try {
    const resp = await fetch(REFRESH_ENDPOINT, { method: "POST", credentials: "include", signal: controller.signal });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function refreshOnce(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const isAuthEndpoint = url.startsWith(`${API_BASE}/auth/`);
  const headers = new Headers(options?.headers);
  const wasAuthed = accessToken !== null;
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  let res = await fetch(url, { ...options, headers, credentials: "include" });

  // 非 auth 端点 401 → 尝试用 cookie refresh 换新 access，成功则重试一次原请求。
  if (res.status === 401 && !isAuthEndpoint) {
    const fresh = await refreshOnce();
    if (fresh) {
      setAccessToken(fresh);
      headers.set("Authorization", `Bearer ${fresh}`);
      res = await fetch(url, { ...options, headers, credentials: "include" });
    }
    if (!fresh || res.status === 401) {
      triggerLogout();
    }
  }
  // 会话纪元守卫：请求发起时已认证、返回时已登出且响应成功，则响应属于上一个用户，丢弃（防跨用户残留）。
  // 401/错误响应不拦截——登出本就由本请求触发（refresh 失败），错误信息应由 assertOk 抛出。
  if (wasAuthed && accessToken === null && res.ok) {
    throw new Error("会话已变更");
  }
  return res;
}

async function readErrorDetail(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  if (!text) return fallback;
  try {
    const data = JSON.parse(text) as { detail?: unknown };
    return typeof data.detail === "string" ? data.detail : fallback;
  } catch {
    return text;
  }
}

// res.json() 收口为 Promise<T>，调用点局部化 cast
export async function parseJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// 收敛各端点 `if (!res.ok) throw new Error(await readErrorDetail(res, ...))` 样板
export async function assertOk(res: Response, fallback: string): Promise<void> {
  if (!res.ok) throw new Error(await readErrorDetail(res, fallback));
}

export { API_BASE, apiFetch, readErrorDetail, refreshOnce };
