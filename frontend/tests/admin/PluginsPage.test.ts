import { describe, expect, it } from "vitest";
import { parseMcpJsonImport, parseMcpJsonPluginDrafts } from "../../src/features/admin/pluginMcpImport";

describe("parseMcpJsonImport", () => {
  it("imports legacy mcpServers config as unpublished platform plugins", () => {
    const drafts = parseMcpJsonImport(JSON.stringify({
      mcpServers: {
        "bing-search": {
          command: "npx",
          args: ["-y", "bing-cn-mcp"],
          env: { API_KEY: "secret" },
        },
      },
    }));

    expect(drafts).toEqual([{
      slug: "bing-search",
      name: "bing-search",
      description: "",
      transport: "stdio",
      command: "npx",
      args: ["-y", "bing-cn-mcp"],
      env_vars: { API_KEY: "secret" },
      url: undefined,
      permission_level: "read",
      is_published: false,
    }]);
  });

  it("supports several MCP services and keeps them unpublished", () => {
    const drafts = parseMcpJsonImport(JSON.stringify({
      mcpServers: {
        search: { command: "npx" },
        remote: { type: "streamable-http", url: "https://example.com/mcp" },
      },
    }));

    expect(drafts.map((draft) => [draft.slug, draft.transport, draft.is_published])).toEqual([
      ["search", "stdio", false],
      ["remote", "streamable-http", false],
    ]);
  });

  it("uses a numeric MCP service name as the plugin identifier", () => {
    const [draft] = parseMcpJsonImport('{"mcpServers":{"12306-mcp":{"command":"npx"}}}');
    expect(draft.slug).toBe("12306-mcp");
  });

  it("rejects malformed MCP configuration", () => {
    expect(() => parseMcpJsonImport('{"mcpServers":{"search":{"args":"npx"}}}')).toThrow("缺少启动命令");
  });

  it("distinguishes an omitted environment configuration from an explicit one", () => {
    expect(parseMcpJsonPluginDrafts('{"command":"npx"}')[0].includesEnvironmentVariables).toBe(false);
    expect(parseMcpJsonPluginDrafts('{"command":"npx","env":{"API_KEY":"secret"}}')[0].includesEnvironmentVariables).toBe(true);
  });
});
