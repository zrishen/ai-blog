import type { WorkspaceNode } from "@/api/workspace";
import { formatDate as formatBjDate } from "@/lib/datetime";

/** 文件夹树节点：children=子文件夹，resources=挂靠的文件/文章资源 */
export interface TreeFolder extends WorkspaceNode {
  children: TreeFolder[];
  resources: WorkspaceNode[];
}

/** 把扁平 WorkspaceNode[] 组装成文件夹树（folder 按 parent_id 挂靠；resource 挂到所属 folder） */
export function buildTree(nodes: WorkspaceNode[]): TreeFolder[] {
  const folders = nodes.filter((n) => n.node_type === "folder");
  const byId = new Map<number, TreeFolder>();
  folders.forEach((f) => byId.set(f.id, { ...f, children: [], resources: [] }));
  nodes.forEach((n) => {
    if (n.node_type === "resource" && n.parent_id != null && byId.has(n.parent_id)) {
      byId.get(n.parent_id)!.resources.push(n);
    }
  });
  const roots: TreeFolder[] = [];
  byId.forEach((f) => {
    if (f.parent_id && byId.has(f.parent_id)) byId.get(f.parent_id)!.children.push(f);
    else roots.push(f);
  });
  return roots;
}

/** 扁平化文件夹树为 {id,name,depth}[]，供列表/选择器渲染（depth 用于缩进） */
export function flattenFolders(
  folders: TreeFolder[],
  depth = 0,
): { id: number; name: string; depth: number }[] {
  const out: { id: number; name: string; depth: number }[] = [];
  for (const f of folders) {
    out.push({ id: f.id, name: f.name, depth });
    if (f.children.length > 0) out.push(...flattenFolders(f.children, depth + 1));
  }
  return out;
}

/** ISO → 北京时间日期（YYYY/MM/DD），空/非法返回空串。 */
export function formatDate(iso: string | undefined | null): string {
  return formatBjDate(iso);
}

/** 拖拽源类型：
 *  - blog_post / file：未挂靠资源，attachResource 首次归档
 *  - folder：文件夹，moveNode 树内移动
 *  - resource：已挂靠资源，moveResource 文件夹间移动（带 resourceType）
 */
export type WorkspaceDragSource = {
  type: "blog_post" | "file" | "folder" | "resource";
  id: number;
  resourceType?: "blog_post" | "file";
};

/** 解析工作区拖拽数据 → WorkspaceDragSource，不匹配返回 null
 *  - "blog:id"                 → 博客文章（归档）
 *  - "file:id"                 → 文件（归档）
 *  - "ws-folder:id"            → 文件夹（树内移动）
 *  - "ws-resource:<type>:<id>" → 已挂靠资源（文件夹间移动）
 */
export function parseWorkspaceDrag(raw: string): WorkspaceDragSource | null {
  const m = raw.match(/^(blog|file|ws-folder):(\d+)$/);
  if (m) {
    const t = m[1] === "blog" ? "blog_post" : m[1] === "ws-folder" ? "folder" : "file";
    return { type: t, id: Number(m[2]) };
  }
  const r = raw.match(/^ws-resource:(blog_post|file):(\d+)$/);
  if (r) {
    return { type: "resource", id: Number(r[2]), resourceType: r[1] as "blog_post" | "file" };
  }
  return null;
}
