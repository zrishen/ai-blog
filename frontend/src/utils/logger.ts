/**
 * 前端日志：错误上报后端写进 app.log（dev 同时走 console），警告仅在 dev console / 可选 Sentry 中记录。
 *
 * 上报走裸 fetch（不经 apiFetch，避免 401 拦截卡住登录页崩溃上报）；keepalive 让页面 unload 也能发出。
 * 节流防死循环刷爆带宽：同 message+source 10s 内只发一次，全局 30s 内最多 20 条。
 */
import * as Sentry from "@sentry/react";

import { API_BASE, getAccessToken } from "../api/client";

const isProd = import.meta.env.PROD;
const DEDUPE_WINDOW_MS = 10_000; // 同 message+source 去重窗口
const RATE_WINDOW_MS = 30_000; // 全局速率窗口
const RATE_MAX = 20; // 窗口内最多上报条数

const lastSent = new Map<string, number>(); // key -> 最近发送时间戳
const recentSent: number[] = []; // 滑动窗口时间戳队列

interface ClientErrorPayload {
  message: string;
  stack: string | undefined;
  url: string;
  source: string;
}

/** 节流：去重 + 全局速率。返回 true 表示应丢弃（已节流）。通过则记一次并返回 false。 */
function shouldThrottle(source: string, message: string): boolean {
  const now = Date.now();
  const key = `${source}:${message}`;
  const last = lastSent.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return true;
  for (const [seenKey, seenAt] of lastSent) {
    if (now - seenAt >= DEDUPE_WINDOW_MS) lastSent.delete(seenKey);
  }
  while (recentSent.length > 0 && now - recentSent[0] >= RATE_WINDOW_MS) recentSent.shift();
  if (recentSent.length >= RATE_MAX) return true;
  lastSent.set(key, now);
  recentSent.push(now);
  return false;
}

async function postClientError(payload: ClientErrorPayload): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // 裸 fetch：不引 apiFetch，防 logger↔client 循环依赖；keepalive 让 unload 也能发。
  await fetch(`${API_BASE}/client-errors`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    keepalive: true,
  });
}

interface ErrorContext {
  source?: string;
  componentStack?: string;
  [k: string]: unknown;
}

/** 记录错误：dev 同时走 console，所有环境均上报后端 app.log；Sentry 的全局捕获由 SDK 自己负责。 */
export function logError(error: unknown, context: ErrorContext = {}): void {
  const err = error instanceof Error ? error : new Error(String(error));
  if (!isProd) {
    console.error("[client]", err, context); // dev 即时看；仍继续上报本地后端以验证链路
  }
  const source = typeof context.source === "string" ? context.source : "logger";
  if (shouldThrottle(source, err.message)) return;
  const stack = [err.stack, context.componentStack].filter(Boolean).join("\n") || undefined;
  void postClientError({
    message: err.message,
    stack,
    url: location.pathname,
    source,
  }).catch(() => {
    /* 上报失败静默，不能再抛 */
  });
}

/** 记录警告：dev 走 console；prod 仅 Sentry（不上报后端，避免噪音）。 */
export function logWarn(message: string, context?: Record<string, unknown>): void {
  if (!isProd) {
    console.warn("[client]", message, context ?? {});
    return;
  }
  Sentry.captureMessage(message, { level: "warning", extra: context });
}
