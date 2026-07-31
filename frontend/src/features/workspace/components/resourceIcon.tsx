import { Network } from "lucide-react";
import { getFileIcon } from "@/components/fileIcons";
import blogIcon from "@/components/icons/blog.svg";
import type { WorkspaceNode } from "@/api/client";

/**
 * 工作区资源图标（左侧目录树 + 中栏平铺共用）：
 * - blog_post（文章）→ blog.svg
 * - file（文件）→ 按扩展名复用 getFileIcon（PDF/Word/Excel/图片… 彩色图标）
 * - 其余（research_topic 等）→ Network
 */
export function getResourceIcon(node: WorkspaceNode) {
  switch (node.resource_type) {
    case "blog_post":
      return <img src={blogIcon} alt="" aria-hidden className="h-4 w-4 flex-shrink-0" />;
    case "file":
      return getFileIcon(node.name);
    default:
      return <Network className="h-4 w-4 flex-shrink-0 text-muted-foreground" />;
  }
}
