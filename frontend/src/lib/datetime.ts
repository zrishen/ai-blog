/**
 * 统一时间工具。
 *
 * 约定：后端 DB/API 一律存 UTC（naive datetime，序列化后无时区后缀，如 "2026-08-05T12:00:00"）。
 * 展示层固定为北京时间（Asia/Shanghai），与浏览器本地时区无关。
 *
 * 关键点：JS 对「无时区后缀的 date-time 串」按本地时区解析，会把 UTC 数值误当本地时间，
 * 在 UTC+8 下偏差 8 小时。parseDate 对这类串补 "Z" 强制按 UTC 解析。
 */

const BJ_TZ = "Asia/Shanghai";

/** 解析后端时间值为 Date；非法/空返回 null。无时区标记的串按 UTC 处理。 */
export function parseDate(input: string | number | Date | null | undefined): Date | null {
  if (input == null) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input === "number") {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = input.trim();
  if (!s) return null;
  const hasTz = /[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
  const d = new Date(hasTz ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 完整日期：YYYY/MM/DD。 */
export function formatDate(input: string | number | Date | null | undefined): string {
  const d = parseDate(input);
  if (!d) return "";
  return d.toLocaleDateString("zh-CN", {
    timeZone: BJ_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** 长格式日期：YYYY年M月D日。 */
export function formatDateLong(input: string | number | Date | null | undefined): string {
  const d = parseDate(input);
  if (!d) return "";
  return d.toLocaleDateString("zh-CN", {
    timeZone: BJ_TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** 月日：M月D日。 */
export function formatMonthDay(input: string | number | Date | null | undefined): string {
  const d = parseDate(input);
  if (!d) return "";
  return d.toLocaleDateString("zh-CN", {
    timeZone: BJ_TZ,
    month: "short",
    day: "numeric",
  });
}

/** 日期时间：YYYY/MM/DD HH:mm:ss。 */
export function formatDateTime(input: string | number | Date | null | undefined): string {
  const d = parseDate(input);
  if (!d) return "";
  return d.toLocaleString("zh-CN", {
    timeZone: BJ_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** 月日 + 时分：M月D日 HH:mm。 */
export function formatMonthDayTime(input: string | number | Date | null | undefined): string {
  const d = parseDate(input);
  if (!d) return "";
  return d.toLocaleString("zh-CN", {
    timeZone: BJ_TZ,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 时分（可选秒）：HH:mm 或 HH:mm:ss。 */
export function formatClock(
  input: string | number | Date | null | undefined,
  withSeconds = false,
): string {
  const d = parseDate(input);
  if (!d) return "";
  return d.toLocaleTimeString("zh-CN", {
    timeZone: BJ_TZ,
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
}
