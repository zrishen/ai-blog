import type { AuthUser } from "@/types/auth";

/** 运行时校验后端返回的 user 对象形状，防止字段缺失整体入库导致门禁误判。 */
export function isAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Record<string, unknown>;
  return typeof user.id === "number"
    && typeof user.username === "string"
    && typeof user.is_admin === "boolean"
    && typeof user.is_super_admin === "boolean";
}
