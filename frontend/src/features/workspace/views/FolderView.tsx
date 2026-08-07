import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Eye,
  Folder,
  MoreHorizontal,
  Move,
  Pencil,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useChat } from "../../../stores/chatStore";
import { listFileDocuments, type FileDocument, type WorkspaceNode } from "../../../api/client";
import { getWorkspaceTree } from "../../../api/workspace";
import { flattenFolders, useResourceActions } from "../components/resourceActions";
import { ResourceDialogs } from "../components/ResourceDialogs";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import folderIcon from "@/components/icons/folder.svg";
import { getResourceIcon } from "../components/resourceIcon";
import { SubPageHeader, WorkspaceView } from "./shared";

const RESOURCE_LABEL: Record<string, string> = {
  blog_post: "文章",
  file: "文件",
};

export function FolderView({
  folderId,
  onOpenBlog,
  onOpenFile,
  onBack,
}: {
  folderId: number;
  onOpenBlog: (id: number) => void;
  onOpenFile: (filePath: string) => void;
  onBack: () => void;
}) {
  const { state, dispatch } = useChat();
  const tree = state.workspaceTree;
  // 文件资源点击预览需要 file_path,WorkspaceNode 未存,本地缓存文件列表反查
  const [docs, setDocs] = useState<FileDocument[]>([]);

  const reload = useCallback(async () => {
    try {
      const nodes = await getWorkspaceTree();
      dispatch({ type: "SET_WORKSPACE_TREE", payload: nodes });
    } catch {
      /* ignore */
    }
  }, [dispatch]);

  const resourceActions = useResourceActions(reload);

  useEffect(() => {
    let alive = true;
    listFileDocuments()
      .then((r) => {
        if (alive) setDocs(r.documents);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      alive = false;
    };
  }, [state.fileLibraryRevision]);

  // 同左侧栏顺序：子文件夹在上方，资源在后，合并成一个列表（不再分卡片网格与列表）
  const items = useMemo(() => {
    const subs = tree.filter((n) => n.node_type === "folder" && n.parent_id === folderId);
    const res = tree.filter((n) => n.node_type === "resource" && n.parent_id === folderId);
    return [...subs, ...res];
  }, [tree, folderId]);

  const flatFolders = useMemo(() => flattenFolders(tree), [tree]);

  const openResource = async (r: WorkspaceNode) => {
    if (r.resource_type === "blog_post" && r.resource_id != null) {
      onOpenBlog(r.resource_id);
    } else if (r.resource_type === "file" && r.resource_id != null) {
      let doc = docs.find((d) => d.id === r.resource_id);
      if (!doc) {
        try {
          const response = await listFileDocuments();
          setDocs(response.documents);
          doc = response.documents.find((d) => d.id === r.resource_id);
        } catch {
          return;
        }
      }
      if (doc) onOpenFile(doc.file_path);
    }
  };

  return (
    <WorkspaceView header={<SubPageHeader onBack={onBack} />}>
      {items.length === 0 ? (
        <EmptyState
          icon={Folder}
          title="这里还没有内容"
          description="把草稿或文件拖进来归档，或在左侧新建子文件夹。"
          className="flex-1 p-10"
        />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <ul className="flex flex-col">
            {items.map((n) =>
              n.node_type === "folder" ? (
                <FolderRow
                  key={n.id}
                  folder={n}
                  onOpen={() => dispatch({ type: "SET_WORKSPACE_SELECTED_FOLDER", payload: n.id })}
                />
              ) : (
                <ResourceRow
                  key={n.id}
                  node={n}
                  openResource={openResource}
                  actions={resourceActions}
                />
              ),
            )}
          </ul>
        </div>
      )}

      <ResourceDialogs actions={resourceActions} flatFolders={flatFolders} />
    </WorkspaceView>
  );
}

// 子文件夹行：与资源行混排（顺序同左侧栏：子文件夹在上方，资源在后），点击进入子目录。
function FolderRow({ folder, onOpen }: { folder: WorkspaceNode; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-secondary/60"
      >
        <img src={folderIcon} alt="" aria-hidden className="h-4 w-4 flex-shrink-0" />
        <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">{folder.name}</span>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

// 资源行：右键菜单 + ⋯ 下拉（内容一致）+ inline 重命名。中栏平铺样式。
function ResourceRow({
  node,
  openResource,
  actions,
}: {
  node: WorkspaceNode;
  openResource: (r: WorkspaceNode) => void | Promise<void>;
  actions: ReturnType<typeof useResourceActions>;
}) {
  const isFile = node.resource_type === "file";
  const isBlog = node.resource_type === "blog_post";
  const canManage = isFile || isBlog; // 重命名/删除仅文件与文章（研究无对应操作）
  const openable = isBlog || isFile;
  const isRenaming = actions.rename?.nodeId === node.id;

  if (isRenaming) {
    return (
      <li className="flex items-center gap-3 rounded-control px-3 py-2">
        {getResourceIcon(node)}
        <Input
          value={actions.rename!.value}
          autoFocus
          onChange={(e) =>
            actions.setRename((cur) => (cur ? { ...cur, value: e.target.value } : cur))
          }
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") actions.submitRename();
            if (e.key === "Escape") actions.setRename(null);
          }}
          onBlur={() => (actions.rename?.value.trim() ? actions.submitRename() : actions.setRename(null))}
          onClick={(e) => e.stopPropagation()}
          className="h-7 flex-1 rounded-control border-border bg-card px-2 text-body"
        />
      </li>
    );
  }

  const menuActions: { icon: LucideIcon; label: string; run: () => void }[] = [
    ...(openable
      ? [
          {
            icon: Eye,
            label: "预览",
            run: () => {
              void openResource(node);
            },
          },
        ]
      : []),
    {
      icon: Move,
      label: "移动",
      run: () => {
        actions.setMoveTarget({ node, currentFolderId: node.parent_id });
        actions.setMoveParentId(undefined);
      },
    },
    ...(canManage
      ? [
          {
            icon: Pencil,
            label: "重命名",
            run: () =>
              actions.setRename({
                nodeId: node.id,
                resourceId: node.resource_id!,
                resourceType: isFile ? "file" : "blog_post",
                value: node.name,
              }),
          },
        ]
      : []),
  ];
  const destructiveActions = canManage
    ? [{ icon: Trash2, label: "删除", run: () => actions.setDeleteTarget({ node, name: node.name }) }]
    : [];

  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              void openResource(node);
            }}
            onKeyDown={(e) => {
              if (openable && (e.key === "Enter" || e.key === " ")) {
                void openResource(node);
              }
            }}
            className={cn(
              "group flex w-full items-center gap-3 rounded-control px-3 py-2 text-left transition-colors data-[state=open]:bg-primary/10",
              openable ? "cursor-pointer hover:bg-secondary/60" : "cursor-default",
            )}
          >
            {getResourceIcon(node)}
            <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
              {node.name}
            </span>
            <Badge variant="outline">
              {RESOURCE_LABEL[node.resource_type ?? ""] ?? node.resource_type}
            </Badge>
            {/* ⋯ 菜单：移动端常驻、桌面 hover 显示,与右键菜单内容一致 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`${node.name} 更多操作`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-secondary hover:text-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {menuActions.map((a) => (
                  <DropdownMenuItem key={a.label} onClick={a.run}>
                    <a.icon className="h-4 w-4" />
                    {a.label}
                  </DropdownMenuItem>
                ))}
                {destructiveActions.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    {destructiveActions.map((a) => (
                      <DropdownMenuItem key={a.label} variant="destructive" onClick={a.run}>
                        <a.icon className="h-4 w-4" />
                        {a.label}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-40">
          {menuActions.map((a) => (
            <ContextMenuItem key={a.label} onClick={a.run}>
              <a.icon className="h-4 w-4" />
              {a.label}
            </ContextMenuItem>
          ))}
          {destructiveActions.length > 0 && (
            <>
              <ContextMenuSeparator />
              {destructiveActions.map((a) => (
                <ContextMenuItem key={a.label} variant="destructive" onClick={a.run}>
                  <a.icon className="h-4 w-4" />
                  {a.label}
                </ContextMenuItem>
              ))}
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}
