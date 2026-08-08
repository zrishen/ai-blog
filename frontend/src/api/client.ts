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

async function doRefresh(): Promise<string | null> {
  try {
    const resp = await fetch(REFRESH_ENDPOINT, { method: "POST", credentials: "include" });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
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
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  let res = await fetch(url, { ...options, headers, credentials: "include" });

  // 非 auth 端点 401 → 尝试用 cookie refresh 换新 access，成功则重试一次原请求。
  if (res.status === 401 && !isAuthEndpoint) {
    const fresh = await refreshOnce();
    if (fresh) {
      setAccessToken(fresh);
      window.dispatchEvent(new Event("auth:token-refreshed"));
      headers.set("Authorization", `Bearer ${fresh}`);
      res = await fetch(url, { ...options, headers, credentials: "include" });
    }
    if (!fresh || res.status === 401) {
      triggerLogout();
    }
  }
  return res;
}

async function readErrorDetail(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  if (!text) return fallback;
  try {
    const data = JSON.parse(text);
    return typeof data.detail === "string" ? data.detail : fallback;
  } catch {
    return text;
  }
}

export { API_BASE, apiFetch, readErrorDetail, refreshOnce };
