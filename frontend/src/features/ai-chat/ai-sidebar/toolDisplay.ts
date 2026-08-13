/** 工具名展示 registry：后端工具名(snake_case 或单词名) → 前端中文展示名。
 *
 * 纯显示层，不影响 AISidebarChat 的 toolName 行为分派。
 * workspace_files 工具是裸单词名(read/write/edit...)，精确匹配不切分。
 */

export type ToolLike = { start?: { toolName?: string } | null; end?: { toolName?: string } | null };

export const TOOL_DISPLAY: Record<string, string> = {
  // writing
  blog_create_post: "创建文章",
  blog_write_post: "撰写文章",
  blog_edit_post: "编辑文章",
  blog_delete_post: "删除文章",
  blog_search_posts: "搜索文章",
  blog_read_post: "读取文章",
  update_blog_sidebar: "更新侧栏",
  // knowledge
  base_search_file: "检索文件",
  knowledge_query_graph: "查询知识图谱",
  // memory
  base_recall_memory: "回忆记忆",
  // web
  web_search: "网络搜索",
  web_fetch: "抓取网页",
  // workspace_files（裸单词名，精确匹配）
  read: "读取文件",
  write: "写入文件",
  edit: "编辑文件",
  glob: "查找文件",
  grep: "搜索内容",
  move: "移动文件",
  delete: "删除文件",
  git: "Git 操作",
};

export function formatToolName(tool: ToolLike): string {
  const name = tool.end?.toolName || tool.start?.toolName || "";
  return TOOL_DISPLAY[name] || name || "操作";
}

export function toolPrepLabel(toolName: string): string {
  if (toolName === "blog_write_post") return "正在生成文章";
  if (toolName === "blog_create_post") return "正在创建草稿";
  if (toolName === "blog_edit_post") return "正在生成修改";
  const display = TOOL_DISPLAY[toolName];
  if (display) return `正在${display}`;
  if (toolName.startsWith("blog_")) return "正在生成文章";
  if (toolName.startsWith("file_") || toolName.includes("search")) return "正在检索文件";
  return `正在准备 ${toolName}`;
}
