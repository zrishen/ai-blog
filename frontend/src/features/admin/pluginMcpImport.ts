import type { AdminPluginDraft, PluginPermissionLevel, PluginTransport } from "@/api/client";

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`);
  }
  return value as Record<string, unknown>;
}

function normalizeSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error("每个 MCP 服务都需要由英文字母或数字开头的名称");
  }
  return slug.slice(0, 80);
}

function stringArray(value: unknown, label: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${label}必须是字符串数组`);
  }
  return value;
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  if (value == null) return {};
  const record = asObject(value, label);
  if (Object.values(record).some((item) => typeof item !== "string")) {
    throw new Error(`${label}的值必须是字符串`);
  }
  return record as Record<string, string>;
}

export type ParsedMcpJsonPlugin = {
  draft: AdminPluginDraft;
  includesEnvironmentVariables: boolean;
};

function draftFromMcpConfig(sourceName: string, rawConfig: unknown): ParsedMcpJsonPlugin {
  const config = asObject(rawConfig, `“${sourceName}”配置`);
  const name = typeof config.name === "string" && config.name.trim() ? config.name.trim() : sourceName;
  const requestedTransport = config.type ?? config.transport;
  const transport: PluginTransport = requestedTransport === "streamable-http" || (!requestedTransport && typeof config.url === "string")
    ? "streamable-http"
    : "stdio";
  const permissionLevel: PluginPermissionLevel = config.permission_level === "write" ? "write" : "read";
  const command = typeof config.command === "string" ? config.command.trim() : "";
  const url = typeof config.url === "string" ? config.url.trim() : "";

  if (transport === "stdio" && !command) throw new Error(`“${name}”缺少启动命令`);
  if (transport === "streamable-http" && !url) throw new Error(`“${name}”缺少服务 URL`);

  return {
    draft: {
      slug: normalizeSlug(sourceName),
      name,
      description: typeof config.description === "string" ? config.description : "",
      transport,
      command: transport === "stdio" ? command : undefined,
      args: stringArray(config.args, `“${name}”参数`),
      env_vars: stringRecord(config.env_vars ?? config.env, `“${name}”环境变量`),
      url: transport === "streamable-http" ? url : undefined,
      permission_level: permissionLevel,
      is_published: false,
    },
    includesEnvironmentVariables: "env_vars" in config || "env" in config,
  };
}

/** 将 MCP JSON 转为平台插件草稿，仅由管理员后台调用。 */
export function parseMcpJsonPluginDrafts(value: string): ParsedMcpJsonPlugin[] {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw new Error("JSON 格式错误，请检查后重试");
  }
  const root = asObject(raw, "MCP 配置");
  if ("mcpServers" in root) {
    const servers = asObject(root.mcpServers, "mcpServers");
    const entries = Object.entries(servers);
    if (entries.length === 0) throw new Error("mcpServers 不能为空");
    return entries.map(([name, config]) => draftFromMcpConfig(name, config));
  }
  const name = typeof root.name === "string" && root.name.trim() ? root.name.trim() : "imported-plugin";
  return [draftFromMcpConfig(name, root)];
}

/** 兼容原有调用方，只返回未发布的平台插件草稿。 */
export function parseMcpJsonImport(value: string): AdminPluginDraft[] {
  return parseMcpJsonPluginDrafts(value).map(({ draft }) => draft);
}
