import { describe, expect, it } from "vitest";

import { TOOL_DISPLAY, formatToolName, toolPrepLabel } from "../../src/features/ai-chat/ai-sidebar/toolDisplay";

// formatToolName 接收 ToolPair；测试只需 end.toolName，用最小对象。
function pair(toolName: string) {
  return { end: { toolName } } as Parameters<typeof formatToolName>[0];
}

describe("tool display registry", () => {
  it("TOOL_DISPLAY 覆盖全部已知工具名（含 workspace_files 裸单词名）", () => {
    const expected = [
      "blog_create_post", "blog_write_post", "blog_edit_post", "blog_delete_post",
      "blog_search_posts", "blog_read_post", "update_blog_sidebar",
      "base_search_file", "knowledge_query_graph", "base_recall_memory",
      "web_search", "web_fetch",
      "read", "write", "edit", "glob", "grep", "move", "delete", "git",
      "mcp_call_tool",
    ];
    for (const name of expected) {
      expect(TOOL_DISPLAY[name], `${name} 应有展示名`).toBeTruthy();
    }
  });

  it("formatToolName 命中 registry 返回中文展示名", () => {
    expect(formatToolName(pair("base_recall_memory"))).toBe("回忆记忆");
    expect(formatToolName(pair("web_fetch"))).toBe("抓取网页");
    // 裸单词名精确匹配（不切分）
    expect(formatToolName(pair("read"))).toBe("读取文件");
    expect(formatToolName(pair("git"))).toBe("Git 操作");
  });

  it("formatToolName 未命中返回原始工具名", () => {
    expect(formatToolName(pair("some_future_tool"))).toBe("some_future_tool");
  });

  it("formatToolName 无工具名回退「操作」", () => {
    expect(formatToolName({} as Parameters<typeof formatToolName>[0])).toBe("操作");
  });

  it("toolPrepLabel 具名优先（保持既有精确文案）", () => {
    expect(toolPrepLabel("blog_write_post")).toBe("正在生成文章");
    expect(toolPrepLabel("blog_create_post")).toBe("正在创建草稿");
    expect(toolPrepLabel("blog_edit_post")).toBe("正在生成修改");
  });

  it("toolPrepLabel registry 命中用「正在 + 展示名」", () => {
    expect(toolPrepLabel("base_recall_memory")).toBe("正在回忆记忆");
    expect(toolPrepLabel("web_search")).toBe("正在网络搜索");
    expect(toolPrepLabel("grep")).toBe("正在搜索内容");
  });

  it("toolPrepLabel 未命中保留启发式兜底", () => {
    expect(toolPrepLabel("blog_future")).toBe("正在生成文章");
    expect(toolPrepLabel("file_scan")).toBe("正在检索文件");
    expect(toolPrepLabel("totally_unknown")).toBe("正在准备 totally_unknown");
  });
});
