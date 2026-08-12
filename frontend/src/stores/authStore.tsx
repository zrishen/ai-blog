/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

import { parseJson, setAccessToken } from "../api/client";
import { clearStorageByPrefix } from "../lib/clearStorageByPrefix";
import { isAuthUser } from "../lib/isAuthUser";

import type { AuthUser } from "../types/auth";

export type { AuthUser } from "../types/auth";

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  // 启动时通过 cookie 恢复登录态期间为 true，避免刷新页面闪烁未登录态
  isInitializing: boolean;
}

interface AuthContextValue extends AuthState {
  login: (accessToken: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const UNAUTHENTICATED: AuthState = {
  user: null,
  isAuthenticated: false,
  isInitializing: false,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ ...UNAUTHENTICATED, isInitializing: true });

  useEffect(() => {
    let cancelled = false;
    // 启动恢复：access token 在内存（刷新页面即丢失），用 HttpOnly cookie 里的 refresh token 换新 access。
    void (async () => {
      // 首屏 refresh 加超时：端点 hang 住时避免 isInitializing 永久为 true、应用白屏
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const resp = await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include", signal: controller.signal });
        if (resp.ok) {
          const data = await parseJson<{ access_token?: string; user?: unknown }>(resp);
          if (isAuthUser(data.user) && typeof data.access_token === "string" && !cancelled) {
            setAccessToken(data.access_token);
            setState({ user: data.user, isAuthenticated: true, isInitializing: false });
            return;
          }
        }
      } catch {
        /* 未登录或网络异常都回落到未认证态 */
      } finally {
        clearTimeout(timer);
      }
      if (!cancelled) setState({ ...UNAUTHENTICATED, isInitializing: false });
    })();

    const onLogout = () => {
      setAccessToken(null);
      clearStorageByPrefix("draft_blog_");
      setState(UNAUTHENTICATED);
    };
    window.addEventListener("auth:logout", onLogout);
    return () => {
      cancelled = true;
      window.removeEventListener("auth:logout", onLogout);
    };
  }, []);

  const login = (accessToken: string, user: AuthUser) => {
    setAccessToken(accessToken);
    setState({ user, isAuthenticated: true, isInitializing: false });
  };

  const logout = () => {
    // 通知后端吊销 refresh token 记录并清除 cookie；即便请求失败也立即清前端登录态。
    void fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    setAccessToken(null);
    clearStorageByPrefix("draft_blog_");
    setState(UNAUTHENTICATED);
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
