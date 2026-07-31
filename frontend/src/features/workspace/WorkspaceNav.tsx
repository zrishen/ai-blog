import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Eye,
  FolderPlus,
  Inbox,
  LayoutDashboard,
  MoreHorizontal,
  Move,
  Pencil,
  Sparkles,
  Trash2,
  Upload,
  FileText,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import folderIcon from "@/components/icons/folder.svg";
import { getResourceIcon } from "./components/resourceIcon";

import { useChat } from "../../stores/chatStore";
import type { WorkspaceView } from "../../stores/types";
import {
  attachResource,
  createFolder,
  deleteNode,
  getBlogPost,
  getWorkspaceTree,
  listFileDocuments,
  moveNode,
  moveResource,
  patchNode,
  reorderNodes,
  type FileDocument,
  type WorkspaceNode,
} from "../../api/client";
import { getFileProcessingJob, uploadToFileLibrary } from "../../api/files";
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
import { Input } from "@/components/ui/input";
import { WorkspacePanel } from "@/components/ui/workspace-panel";
import { cn } from "@/lib/utils";
import {
  flattenFolders,
  useResourceActions,
  type ResourceActions,
} from "./components/resourceActions";
import { ResourceDialogs } from "./components/ResourceDialogs";
import {
  buildTree,
  parseWorkspaceDrag,
  type TreeFolder,
  type WorkspaceDragSource,
} from "./views/utils";

// 拖拽放置位置：before/after=同级排序插入线；inside=移入文件夹
type DropIndicator = { kind: "before" | "after" | "inside"; id: number };

// 拖拽进行中的源（dragstart 写入，drop/dragend 读取后清空）；
// 兜底 dataTransfer.getData 在某些合成事件下返回空的情况。
let activeDragSource: WorkspaceDragSource | null = null;

interface ViewItem {
  key: WorkspaceView;
  label: string;
  icon: LucideIcon;
}

// 内容视图：全部 / 草稿·已发布(博客) / 未分类(文件+文章)
const TYPE_VIEWS: ViewItem[] = [
  { key: "overview", label: "全部", icon: LayoutDashboard },
  { key: "drafts", label: "草稿", icon: FileText },
  { key: "published", label: "已发布", icon: CheckCircle2 },
  { key: "inbox", label: "未分类", icon: Inbox },
];

// 状态/系统视图：AI 知识 · 回收站
const STATE_VIEWS: ViewItem[] = [
  { key: "ai_knowledge", label: "AI 知识", icon: Sparkles },
  { key: "trash", label: "回收站", icon: Trash2 },
];

// 编辑态：new=在 parentId 下新建（null=根级）；rename=改 nodeId 名
type EditingState =
  | { type: "new"; parentId: number | null; value: string }
  | { type: "rename"; nodeId: number; value: string };

function NavItem({
  item,
  active,
  onClick,
}: {
  item: ViewItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-body transition-colors",
        active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent",
      )}
    >
      <Icon className={cn("h-4 w-4 flex-shrink-0", active ? "text-primary" : "")} />
      <span className="flex-1 truncate text-left">{item.label}</span>
    </button>
  );
}

function Divider() {
  return <div className="my-1.5 border-t border-border" />;
}

// 树形连接线（极简：竖线 + 末项圆弧拐角）：每级缩进画一段连接线。
//   pipe │  —— 竖线贯穿（中间层祖先 / 非末项子项都走它，不画横线）
//   corner ╰—— 本节点是末项：竖线只画上半截，底部圆角转向横线（圆弧拐角，非直角）
//   empty   —— 该层祖先已是末项，分支结束，留空
// mask 由 buildMask(ancestorTail, isLast) 生成：ancestorTail 记录每层祖先是否末项，
// isLast 表示本节点是否父容器最后一个子项——末项画圆弧拐角，其余仅竖线。
// pipe 竖线上下各越界 4px 跨过行间 gap，与同列竖线无缝衔接（无隔断）。
type ConnectorType = "pipe" | "corner" | "empty";

function buildMask(ancestorTail: boolean[], isLast: boolean): ConnectorType[] {
  return [
    ...ancestorTail.map<ConnectorType>((t) => (t ? "empty" : "pipe")),
    isLast ? "corner" : "pipe",
  ];
}

function TreeConnectors({ mask }: { mask: ConnectorType[] }) {
  if (mask.length === 0) return null;
  const unit = 10; // 每级缩进单元宽度，与 paddingLeft: depth*10+8 对齐
  const baseX = 8; // left-2，行基础左偏移
  const half = unit / 2;
  return (
    <span className="pointer-events-none absolute inset-y-0 left-0" aria-hidden>
      {mask.map((type, i) => {
        if (type === "empty") return null;
        const x = baseX + i * unit + half; // 该层竖线 x（相对行）
        return (
          <span key={i} className="absolute inset-y-0" style={{ left: x }}>
            {type === "corner" ? (
              // 末项 ╰：竖线只画上半截，底部左下圆角自然转向横线，连到本节点（圆弧拐角，非直角）
              <span
                className="absolute left-0 top-0 h-1/2 w-[5px] border-l border-b border-foreground/25"
                style={{ borderBottomLeftRadius: "5px" }}
              />
            ) : (
              // pipe │：贯穿竖线，上下各越界 4px 跨过行间 gap，与同列竖线无缝衔接（无隔断）
              <span className="absolute left-0 -top-1 -bottom-1 w-px bg-foreground/25" />
            )}
          </span>
        );
      })}
    </span>
  );
}

function InlineNameInput({
  depth,
  mask,
  value,
  placeholder,
  onChange,
  onSubmit,
  onCancel,
}: {
  depth: number;
  mask: ConnectorType[];
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="relative flex items-center gap-2 rounded-control py-1.5 pr-2"
      style={{ paddingLeft: depth * 10 + 8 }}
    >
      <TreeConnectors mask={mask} />
      <span className="h-4 w-4 flex-shrink-0" aria-hidden />
      <img src={folderIcon} alt="" aria-hidden className="h-4 w-4 flex-shrink-0" />
      <Input
        value={value}
        autoFocus
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") onSubmit();
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => (value.trim() ? onSubmit() : onCancel())}
        onClick={(e) => e.stopPropagation()}
        className="h-7 flex-1 rounded-control border-border bg-card px-2 text-body text-foreground"
      />
    </div>
  );
}

interface FolderTreeProps {
  folders: TreeFolder[];
  depth: number;
  ancestorTail: boolean[];
  trailingResourcesCount: number;
  selectedId: number | null;
  editing: EditingState | null;
  dropIndicator: DropIndicator | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onRename: (id: number, name: string) => void;
  onNewSub: (parentId: number) => void;
  onUpload: (folderId: number) => void;
  onEditingValue: (v: string) => void;
  onEditingSubmit: () => void;
  onEditingCancel: () => void;
  onDropIndicatorChange: (ind: DropIndicator | null) => void;
  onDrop: (
    parsed: WorkspaceDragSource,
    target: WorkspaceNode,
    indicator: DropIndicator | null,
    name?: string,
  ) => void | Promise<void>;
  collapsedIds: Set<number>;
  onToggleExpand: (id: number) => void;
  onOpenResource: (type: string, id: number) => void;
  actions: ResourceActions;
}

function FolderTree({
  folders,
  depth,
  ancestorTail,
  trailingResourcesCount,
  selectedId,
  editing,
  dropIndicator,
  onSelect,
  onDelete,
  onRename,
  onNewSub,
  onUpload,
  onEditingValue,
  onEditingSubmit,
  onEditingCancel,
  onDropIndicatorChange,
  onDrop,
  collapsedIds,
  onToggleExpand,
  onOpenResource,
  actions,
}: FolderTreeProps) {
  return (
    <div className="flex flex-col gap-0.5">
      {folders.map((f, index) => {
        const isRenaming = editing?.type === "rename" && editing.nodeId === f.id;
        const showNewSub = editing?.type === "new" && editing.parentId === f.id;
        const isSelected = selectedId === f.id;
        const isInside = dropIndicator?.id === f.id && dropIndicator.kind === "inside";
        // 是否父容器最后一个子项：仅当是 folders 末项、且其后没有资源时成立
        const isLast = index === folders.length - 1 && trailingResourcesCount === 0;
        // depth=0（根级）不画连接线，也不向子级传递末项状态——子级首层直接连到根级
        const mask = depth === 0 ? [] : buildMask(ancestorTail, isLast);
        const childTail = depth === 0 ? [] : [...ancestorTail, isLast];
        return (
          <div key={f.id}>
            {isRenaming ? (
              <InlineNameInput
                depth={depth}
                mask={mask}
                value={editing?.value ?? ""}
                placeholder="目录名称"
                onChange={onEditingValue}
                onSubmit={onEditingSubmit}
                onCancel={onEditingCancel}
              />
            ) : (
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    role="button"
                    tabIndex={0}
                    draggable
                    onClick={() => onSelect(f.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") onSelect(f.id);
                    }}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      e.dataTransfer.setData("text/plain", `ws-folder:${f.id}`);
                      e.dataTransfer.effectAllowed = "move";
                      activeDragSource = { type: "folder", id: f.id };
                    }}
                    onDragEnd={() => {
                      activeDragSource = null;
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "move";
                      const rect = e.currentTarget.getBoundingClientRect();
                      const y = e.clientY - rect.top;
                      const kind: DropIndicator["kind"] =
                        y < rect.height * 0.4
                          ? "before"
                          : y > rect.height * 0.6
                            ? "after"
                            : "inside";
                      if (dropIndicator?.id !== f.id || dropIndicator.kind !== kind) {
                        onDropIndicatorChange({ kind, id: f.id });
                      }
                    }}
                    onDragLeave={(e) => {
                      const next = e.relatedTarget as Node | null;
                      if (!next || !e.currentTarget.contains(next)) onDropIndicatorChange(null);
                    }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const y = e.clientY - rect.top;
                      const kind: DropIndicator["kind"] =
                        y < rect.height * 0.4
                          ? "before"
                          : y > rect.height * 0.6
                            ? "after"
                            : "inside";
                      onDropIndicatorChange(null);
                      const parsed =
                        parseWorkspaceDrag(e.dataTransfer.getData("text/plain")) ?? activeDragSource;
                      activeDragSource = null;
                      if (parsed) {
                        const name = e.dataTransfer.getData("application/x-ws-name") || undefined;
                        await onDrop(parsed, f, { kind, id: f.id }, name);
                      }
                    }}
                    className={cn(
                      "group relative flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 data-[state=open]:bg-primary/10 has-[[data-state=open]]:bg-primary/10",
                      isSelected
                        ? "bg-primary/10 text-primary"
                        : isInside
                          ? "bg-primary/10 ring-2 ring-inset ring-primary/50"
                          : "text-foreground hover:bg-accent",
                    )}
                    style={{ paddingLeft: depth * 10 + 8 }}
                  >
                    <TreeConnectors mask={mask} />
                    {dropIndicator?.id === f.id && dropIndicator.kind === "before" && (
                      <span className="pointer-events-none absolute -top-px left-2 right-2 h-0.5 rounded-full bg-primary" />
                    )}
                    {dropIndicator?.id === f.id && dropIndicator.kind === "after" && (
                      <span className="pointer-events-none absolute -bottom-px left-2 right-2 h-0.5 rounded-full bg-primary" />
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleExpand(f.id);
                      }}
                      className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-secondary hover:text-foreground"
                      aria-label={collapsedIds.has(f.id) ? "展开" : "折叠"}
                    >
                      <ChevronRight
                        className={cn(
                          "h-3 w-3 transition-transform",
                          collapsedIds.has(f.id) ? "" : "rotate-90",
                        )}
                      />
                    </button>
                    <img
                      src={folderIcon}
                      alt=""
                      aria-hidden
                      className="h-4 w-4 flex-shrink-0"
                    />
                    <span className="flex-1 truncate text-body">{f.name}</span>
                    {f.auto_index && (
                      <span className="text-caption text-muted-foreground">自动索引</span>
                    )}
                    {/* ⋯ 菜单：移动端常驻、桌面 hover 显示，与右键菜单内容一致 */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-secondary hover:text-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100"
                          aria-label={`${f.name} 更多操作`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => onNewSub(f.id)}>
                          <FolderPlus className="h-4 w-4" />
                          新建子目录
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onUpload(f.id)}>
                          <Upload className="h-4 w-4" />
                          上传文件
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onRename(f.id, f.name)}>
                          <Pencil className="h-4 w-4" />
                          重命名
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => onDelete(f.id)}>
                          <Trash2 className="h-4 w-4" />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-40">
                  <ContextMenuItem onClick={() => onNewSub(f.id)}>
                    <FolderPlus className="h-4 w-4" />
                    新建子目录
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onUpload(f.id)}>
                    <Upload className="h-4 w-4" />
                    上传文件
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onRename(f.id, f.name)}>
                    <Pencil className="h-4 w-4" />
                    重命名
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onClick={() => onDelete(f.id)}>
                    <Trash2 className="h-4 w-4" />
                    删除
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )}
            {showNewSub && (
              <InlineNameInput
                depth={depth + 1}
                mask={buildMask(
                  childTail,
                  f.children.length === 0 && f.resources.length === 0,
                )}
                value={editing?.value ?? ""}
                placeholder="新目录名称"
                onChange={onEditingValue}
                onSubmit={onEditingSubmit}
                onCancel={onEditingCancel}
              />
            )}
            {!collapsedIds.has(f.id) && (f.resources.length > 0 || f.children.length > 0) && (
              <div className="flex flex-col gap-0.5">
                {f.children.length > 0 && (
                  <FolderTree
                    folders={f.children}
                    depth={depth + 1}
                    ancestorTail={childTail}
                    trailingResourcesCount={f.resources.length}
                    selectedId={selectedId}
                    editing={editing}
                    dropIndicator={dropIndicator}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    onRename={onRename}
                    onNewSub={onNewSub}
                    onUpload={onUpload}
                    onEditingValue={onEditingValue}
                    onEditingSubmit={onEditingSubmit}
                    onEditingCancel={onEditingCancel}
                    onDropIndicatorChange={onDropIndicatorChange}
                    onDrop={onDrop}
                    collapsedIds={collapsedIds}
                    onToggleExpand={onToggleExpand}
                    onOpenResource={onOpenResource}
                    actions={actions}
                  />
                )}
                {f.resources.map((r, ridx) => (
                  <ResourceItem
                    key={r.id}
                    node={r}
                    depth={depth + 1}
                    ancestorTail={childTail}
                    isLast={ridx === f.resources.length - 1}
                    dropIndicator={dropIndicator}
                    onDropIndicatorChange={onDropIndicatorChange}
                    onDrop={onDrop}
                    onOpen={onOpenResource}
                    actions={actions}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// 文件夹内资源项（文件/文章）：点击/回车打开；右键 + ⋯ 菜单（预览/移动/重命名/删除）；inline 重命名。
function ResourceItem({
  node,
  depth,
  ancestorTail,
  isLast,
  dropIndicator,
  onDropIndicatorChange,
  onDrop,
  onOpen,
  actions,
}: {
  node: WorkspaceNode;
  depth: number;
  ancestorTail: boolean[];
  isLast: boolean;
  dropIndicator: DropIndicator | null;
  onDropIndicatorChange: (ind: DropIndicator | null) => void;
  onDrop: (
    parsed: WorkspaceDragSource,
    target: WorkspaceNode,
    indicator: DropIndicator | null,
  ) => void | Promise<void>;
  onOpen: (type: string, id: number) => void;
  actions: ResourceActions;
}) {
  const isFile = node.resource_type === "file";
  const isBlog = node.resource_type === "blog_post";
  const canManage = isFile || isBlog; // 重命名/删除仅文件与文章（研究无对应操作）
  const openable = isBlog || isFile;
  const rid = node.resource_id;
  const open = () => {
    if (rid != null && openable) onOpen(node.resource_type ?? "file", rid);
  };
  const isRenaming = actions.rename?.nodeId === node.id;
  const mask = buildMask(ancestorTail, isLast);

  if (isRenaming) {
    return (
      <div
        className="relative flex items-center gap-2 rounded-control py-1.5 pr-2"
        style={{ paddingLeft: depth * 10 + 8 }}
      >
        <TreeConnectors mask={mask} />
        <span className="h-4 w-4 flex-shrink-0" aria-hidden />
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
          onBlur={() =>
            actions.rename?.value.trim() ? actions.submitRename() : actions.setRename(null)
          }
          onClick={(e) => e.stopPropagation()}
          className="h-7 flex-1 rounded-control border-border bg-card px-2 text-body text-foreground"
        />
      </div>
    );
  }

  const menuActions: { icon: LucideIcon; label: string; run: () => void }[] = [
    ...(openable ? [{ icon: Eye, label: "预览", run: open }] : []),
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
                resourceId: rid!,
                resourceType: isFile ? "file" : "blog_post",
                value: node.name,
              }),
          },
        ]
      : []),
  ];
  const destructiveActions = canManage
    ? [
        {
          icon: Trash2,
          label: "删除",
          run: () => actions.setDeleteTarget({ node, name: node.name }),
        },
      ]
    : [];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          draggable
          onClick={open}
          onDragStart={(e) => {
            if (rid == null || !node.resource_type) {
              e.preventDefault();
              return;
            }
            e.stopPropagation();
            e.dataTransfer.setData("text/plain", `ws-resource:${node.resource_type}:${rid}`);
            e.dataTransfer.effectAllowed = "move";
            activeDragSource = {
              type: "resource",
              id: rid,
              resourceType: node.resource_type as "blog_post" | "file",
            };
          }}
          onDragEnd={() => {
            activeDragSource = null;
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            const rect = e.currentTarget.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const kind: DropIndicator["kind"] = y < rect.height * 0.5 ? "before" : "after";
            if (dropIndicator?.id !== node.id || dropIndicator.kind !== kind) {
              onDropIndicatorChange({ kind, id: node.id });
            }
          }}
          onDragLeave={(e) => {
            const next = e.relatedTarget as Node | null;
            if (!next || !e.currentTarget.contains(next)) onDropIndicatorChange(null);
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const kind: DropIndicator["kind"] = y < rect.height * 0.5 ? "before" : "after";
            onDropIndicatorChange(null);
            const parsed =
              parseWorkspaceDrag(e.dataTransfer.getData("text/plain")) ?? activeDragSource;
            activeDragSource = null;
            if (parsed) await onDrop(parsed, node, { kind, id: node.id });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              open();
            }
          }}
          className="group relative flex w-full cursor-pointer select-none items-center gap-2 rounded-control py-1.5 pr-2 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/30 data-[state=open]:bg-primary/10 has-[[data-state=open]]:bg-primary/10"
          style={{ paddingLeft: depth * 10 + 8 }}
        >
          <TreeConnectors mask={mask} />
          {dropIndicator?.id === node.id && dropIndicator.kind === "before" && (
            <span className="pointer-events-none absolute -top-px left-2 right-2 h-0.5 rounded-full bg-primary" />
          )}
          {dropIndicator?.id === node.id && dropIndicator.kind === "after" && (
            <span className="pointer-events-none absolute -bottom-px left-2 right-2 h-0.5 rounded-full bg-primary" />
          )}
          <span className="h-4 w-4 flex-shrink-0" aria-hidden />
          {getResourceIcon(node)}
          <span className="min-w-0 flex-1 truncate text-body text-foreground">{node.name}</span>
          {/* ⋯ 菜单：移动端常驻、桌面 hover 显示，与右键菜单内容一致 */}
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
  );
}

// 工作区目录树折叠状态持久化 key
const COLLAPSED_FOLDERS_KEY = "workspace:collapsed-folder-ids";

export function WorkspaceNav() {
  const { state, dispatch } = useChat();
  const [editing, setEditing] = useState<EditingState | null>(null);
  // undefined=未触发上传；null=根级上传(不挂靠)；number=挂靠到该文件夹
  const [uploadTarget, setUploadTarget] = useState<number | null | undefined>(undefined);
  // 拖拽放置位置：before/after=同级排序插入线；inside=移入文件夹
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  // 折叠的文件夹 id：初始从 localStorage 恢复，保留用户上次的展开/折叠状态
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_FOLDERS_KEY);
      if (raw) return new Set(JSON.parse(raw) as number[]);
    } catch {
      /* ignore */
    }
    return new Set();
  });
  // localStorage 已有记录则视为已恢复用户状态，不再默认折叠
  const didInitCollapseRef = useRef(localStorage.getItem(COLLAPSED_FOLDERS_KEY) !== null);
  const toggleExpand = useCallback((id: number) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const [fileDocuments, setFileDocuments] = useState<FileDocument[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedFolderId = state.workspaceSelectedFolderId;
  const view = state.workspaceSelectedView;

  const reload = useCallback(async () => {
    try {
      const nodes = await getWorkspaceTree();
      dispatch({ type: "SET_WORKSPACE_TREE", payload: nodes });
    } catch {
      /* ignore */
    }
  }, [dispatch]);

  // 同级排序：把拖拽源插入目标节点 before/after 位置；仅同类同级（folder↔folder / resource↔resource）。
  // 跨层级先 move 到目标父级再 reorder；未挂靠 blog/file 不参与排序（须先归档进文件夹）。
  const handleReorder = useCallback(
    async (parsed: WorkspaceDragSource, target: WorkspaceNode, kind: "before" | "after") => {
      if (parsed.type !== "folder" && parsed.type !== "resource") return;
      const targetIsFolder = target.node_type === "folder";
      if (parsed.type === "folder" && !targetIsFolder) return;
      if (parsed.type === "resource" && targetIsFolder) return;

      // folder 的 id 即 node id；resource 的 id 是底层 resource_id，
      // 须反查其 WorkspaceNode id 才能参与 reorder（后端按 node id 重排）。
      const sourceNodeId =
        parsed.type === "folder"
          ? parsed.id
          : state.workspaceTree.find(
              (n) =>
                n.node_type === "resource" &&
                n.resource_type === parsed.resourceType &&
                n.resource_id === parsed.id,
            )?.id;
      if (sourceNodeId == null) return;

      const targetParent = target.parent_id;
      const siblings = state.workspaceTree.filter(
        (n) => n.parent_id === targetParent && n.node_type === target.node_type,
      );
      const sourceInPlace = siblings.some((n) => n.id === sourceNodeId);
      const withoutSource = siblings.filter((n) => n.id !== sourceNodeId);
      const idx = withoutSource.findIndex((n) => n.id === target.id);
      if (idx === -1) {
        await reload();
        return;
      }
      const orderedNums = withoutSource.map((n) => n.id);
      orderedNums.splice(kind === "before" ? idx : idx + 1, 0, sourceNodeId);

      try {
        if (!sourceInPlace) {
          if (parsed.type === "folder") {
            await moveNode(parsed.id, targetParent);
          } else if (parsed.resourceType) {
            if (targetParent == null) return;
            await moveResource(parsed.resourceType, parsed.id, targetParent);
          }
        }
        await reorderNodes(targetParent, orderedNums);
        await reload();
        dispatch({ type: "INCREMENT_FILE_LIBRARY_REVISION" });
      } catch (e) {
        console.error("[workspace] 排序失败:", e);
        await reload();
      }
    },
    [state.workspaceTree, reload, dispatch],
  );

  // 拖拽落点：target=null 根级空白(仅 folder 移根)；inside=移入文件夹；before/after=同级排序。
  const handleDrop = useCallback(
    async (
      parsed: WorkspaceDragSource,
      target: WorkspaceNode | null,
      indicator: DropIndicator | null,
      name?: string,
    ) => {
      try {
        if (target === null) {
          if (parsed.type === "folder") await moveNode(parsed.id, null);
          await reload();
          return;
        }
        if (indicator?.kind === "inside") {
          if (parsed.type === "folder") {
            if (parsed.id === target.id) return;
            await moveNode(parsed.id, target.id);
          } else if (parsed.type === "resource") {
            if (!parsed.resourceType) return;
            await moveResource(parsed.resourceType, parsed.id, target.id);
          } else {
            await attachResource(parsed.type as "blog_post" | "file", parsed.id, target.id, name);
          }
          await reload();
          dispatch({ type: "INCREMENT_FILE_LIBRARY_REVISION" });
          return;
        }
        if (indicator?.kind === "before" || indicator?.kind === "after") {
          await handleReorder(parsed, target, indicator.kind);
        }
      } catch (e) {
        console.error("[workspace] 拖拽失败:", e);
      }
    },
    [reload, dispatch, handleReorder],
  );

  useEffect(() => {
    if (state.workspaceTree.length === 0) reload();
  }, [reload, state.workspaceTree.length]);

  // 缓存文件元数据，供左栏 file 资源点击反查 file_path
  useEffect(() => {
    let alive = true;
    listFileDocuments()
      .then((r) => {
        if (alive) setFileDocuments(r.documents);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [state.fileLibraryRevision]);

  // 点左栏资源：blog_post→内联编辑，file→内联预览（反查 file_path）
  const handleOpenResource = useCallback(
    async (type: string, id: number) => {
      if (type === "blog_post") {
        try {
          const post = await getBlogPost(id);
          dispatch({ type: "UPSERT_BLOG_POST", payload: post });
        } catch {
          /* ignore */
        }
        dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: id });
        dispatch({ type: "SET_WORKSPACE_EDITING_BLOG", payload: id });
        dispatch({ type: "SET_FILE_SELECTED_FILE", payload: null });
      } else if (type === "file") {
        const doc = fileDocuments.find((d) => d.id === id);
        if (doc) {
          dispatch({ type: "SET_FILE_SELECTED_FILE", payload: doc.file_path });
          dispatch({ type: "SET_WORKSPACE_EDITING_BLOG", payload: null });
        }
      }
    },
    [dispatch, fileDocuments],
  );

  const onEditingValue = useCallback((value: string) => {
    setEditing((cur) => (cur ? { ...cur, value } : cur));
  }, []);

  const submitEditing = useCallback(async () => {
    if (!editing) return;
    const name = editing.value.trim();
    const snapshot = editing;
    setEditing(null);
    if (!name) return;
    try {
      if (snapshot.type === "rename") {
        await patchNode(snapshot.nodeId, { name });
      } else {
        await createFolder(name, snapshot.parentId);
      }
      await reload();
    } catch {
      /* ignore */
    }
  }, [editing, reload]);

  const cancelEditing = useCallback(() => setEditing(null), []);

  const startNewRoot = useCallback(() => setEditing({ type: "new", parentId: null, value: "" }), []);
  const startNewSub = useCallback(
    (parentId: number) => setEditing({ type: "new", parentId, value: "" }),
    [],
  );
  const startRename = useCallback(
    (nodeId: number, name: string) => setEditing({ type: "rename", nodeId, value: name }),
    [],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await deleteNode(id);
        if (selectedFolderId === id) {
          dispatch({ type: "SET_WORKSPACE_SELECTED_FOLDER", payload: null });
        }
        await reload();
      } catch {
        /* ignore */
      }
    },
    [dispatch, reload, selectedFolderId],
  );

  const requestUpload = useCallback((folderId: number | null) => {
    setUploadTarget(folderId);
    fileInputRef.current?.click();
  }, []);

  const onFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) e.target.value = "";
      if (!file || uploadTarget === undefined) return;
      const target = uploadTarget;
      setUploadTarget(undefined);
      const clientRequestId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `ws-${Date.now()}`;
      try {
        const job = await uploadToFileLibrary(file, undefined, clientRequestId).promise;
        // 上传响应可能尚未处理完(result_document_id 为空),轮询直到拿到文档 id
        let docId = job.result_document_id;
        for (let i = 0; i < 20 && docId == null; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const j = await getFileProcessingJob(job.id);
          docId = j.result_document_id;
          if (j.status === "failed") break;
        }
        if (docId != null && target != null) {
          await attachResource("file", docId, target, file.name);
        }
        await reload();
        dispatch({ type: "INCREMENT_FILE_LIBRARY_REVISION" });
      } catch {
        /* ignore */
      }
    },
    [uploadTarget, reload, dispatch],
  );

  const selectView = useCallback(
    (key: WorkspaceView) => {
      dispatch({ type: "SET_WORKSPACE_EDITING_BLOG", payload: null });
      dispatch({ type: "SET_FILE_SELECTED_FILE", payload: null });
      dispatch({ type: "SET_WORKSPACE_SELECTED_VIEW", payload: key });
      dispatch({ type: "SET_WORKSPACE_SELECTED_FOLDER", payload: null });
    },
    [dispatch],
  );

  const resourceActions = useResourceActions(reload);
  const flatFolders = useMemo(() => flattenFolders(state.workspaceTree), [state.workspaceTree]);
  const folders = buildTree(state.workspaceTree);
  // 首次（无持久状态）默认折叠所有目录；已有记录则保留用户状态。useLayoutEffect 避免首次闪烁
  useLayoutEffect(() => {
    if (didInitCollapseRef.current || flatFolders.length === 0) return;
    didInitCollapseRef.current = true;
    setCollapsedIds(new Set(flatFolders.map((f) => f.node.id)));
  }, [flatFolders]);
  // 折叠状态持久化到 localStorage（初始化完成后才写，避免 tree 未加载时空值覆盖默认折叠）
  useEffect(() => {
    if (!didInitCollapseRef.current) return;
    try {
      localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify([...collapsedIds]));
    } catch {
      /* ignore */
    }
  }, [collapsedIds]);
  const isRootNew = editing?.type === "new" && editing.parentId === null;
  const isEmpty = folders.length === 0 && !isRootNew;

  return (
    <WorkspacePanel className="overflow-y-auto select-none">
      {/* flex-1 min-h-0:撑满面板,使分割线下方区域随剩余空间伸缩,空态真正上下居中 */}
      <div className="flex min-h-0 flex-1 flex-col p-3">
        {TYPE_VIEWS.map((item) => (
          <NavItem
            key={item.key}
            item={item}
            active={selectedFolderId === null && view === item.key}
            onClick={() => selectView(item.key)}
          />
        ))}

        {STATE_VIEWS.map((item) => (
          <NavItem
            key={item.key}
            item={item}
            active={selectedFolderId === null && view === item.key}
            onClick={() => selectView(item.key)}
          />
        ))}

        <Divider />

        <div className="flex items-center justify-between px-2 pb-1 pt-0.5">
          <span className="text-meta font-semibold text-muted-foreground">文件夹</span>
          <button
            type="button"
            onClick={isRootNew ? cancelEditing : startNewRoot}
            aria-label={isRootNew ? "取消新建" : "新建文件夹"}
            className="flex h-5 w-5 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {isRootNew ? <X className="h-3.5 w-3.5" /> : <FolderPlus className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* 整个分割线下方区域统一一个右键菜单(新建目录/上传文件),不与文件夹项的 ⋯ 菜单嵌套 */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className="flex min-h-0 flex-1 flex-col"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("text/plain")) e.preventDefault();
              }}
              onDrop={async (e) => {
                e.preventDefault();
                const parsed = parseWorkspaceDrag(e.dataTransfer.getData("text/plain"));
                if (parsed?.type === "folder") await handleDrop(parsed, null, null);
              }}
            >
              {isRootNew && (
                <InlineNameInput
                  depth={0}
                  mask={[]}
                  value={editing?.value ?? ""}
                  placeholder="新目录名称"
                  onChange={onEditingValue}
                  onSubmit={submitEditing}
                  onCancel={cancelEditing}
                />
              )}
              {isEmpty ? (
                <div className="flex flex-1 items-center justify-center px-6 text-center text-body-lg leading-relaxed text-muted-foreground">
                  右键此处可新建目录或上传文件
                </div>
              ) : (
                <FolderTree
                  folders={folders}
                  depth={0}
                  ancestorTail={[]}
                  trailingResourcesCount={0}
                  selectedId={selectedFolderId}
                  editing={editing}
                  dropIndicator={dropIndicator}
                  onSelect={(id) => {
                    dispatch({ type: "SET_WORKSPACE_EDITING_BLOG", payload: null });
                    dispatch({ type: "SET_FILE_SELECTED_FILE", payload: null });
                    dispatch({ type: "SET_WORKSPACE_SELECTED_FOLDER", payload: id });
                  }}
                  onDelete={handleDelete}
                  onRename={startRename}
                  onNewSub={startNewSub}
                  onUpload={(fid) => requestUpload(fid)}
                  onEditingValue={onEditingValue}
                  onEditingSubmit={submitEditing}
                  onEditingCancel={cancelEditing}
                  onDropIndicatorChange={setDropIndicator}
                  onDrop={handleDrop}
                  collapsedIds={collapsedIds}
                  onToggleExpand={toggleExpand}
                  onOpenResource={handleOpenResource}
                  actions={resourceActions}
                />
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-40">
            <ContextMenuItem onClick={startNewRoot}>
              <FolderPlus className="h-4 w-4" />
              新建目录
            </ContextMenuItem>
            <ContextMenuItem onClick={() => requestUpload(null)}>
              <Upload className="h-4 w-4" />
              上传文件
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
      <input ref={fileInputRef} type="file" hidden onChange={onFileChange} />
      <ResourceDialogs actions={resourceActions} flatFolders={flatFolders} />
    </WorkspacePanel>
  );
}
