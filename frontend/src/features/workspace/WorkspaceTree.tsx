import {
  ChevronRight,
  Eye,
  FileText,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Move,
  Pencil,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";

import type { WorkspaceEntry } from "@/api/workspace";
import type { ReactNode } from "react";

import { BlogIcon, PublishedIcon } from "@/components/icons";
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


function entryIcon(entry: WorkspaceEntry) {
  if (entry.kind === "folder") return <Folder className="h-4 w-4 flex-shrink-0 text-primary" />;
  if (entry.kind === "blog") {
    return entry.blog_status === "published" ? (
      <PublishedIcon className="h-4 w-4 flex-shrink-0" />
    ) : (
      <BlogIcon className="h-4 w-4 flex-shrink-0" />
    );
  }
  return <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />;
}

export interface WorkspaceTreeHandlers {
  openEntry: (entry: WorkspaceEntry) => void;
  requestCreateFolder: (parent: string | null) => void;
  requestUpload: (targetPath: string | null) => void;
  startMove: (entry: WorkspaceEntry) => void;
  startRename: (entry: WorkspaceEntry) => void;
  requestDeleteFolder: (entry: WorkspaceEntry) => void;
  requestDeleteFile: (entry: WorkspaceEntry) => void;
  requestDeleteResource: (entry: WorkspaceEntry) => void;
  joinKnowledge: (entry: WorkspaceEntry) => void;
  moveFromDrop: (sourcePath: string, targetPath: string) => void;
  toggleFolder: (path: string) => void;
}

interface WorkspaceTreeProps {
  entries: WorkspaceEntry[];
  entriesByParent: Map<string | null, WorkspaceEntry[]>;
  collapsedPaths: Set<string>;
  selectedFolderPath: string | null;
  handlers: WorkspaceTreeHandlers;
}

function EntryMenuItems({
  menu,
  entry,
  handlers,
  canManageResource,
}: {
  menu: "dropdown" | "context";
  entry: WorkspaceEntry;
  handlers: WorkspaceTreeHandlers;
  canManageResource: boolean;
}) {
  const isFolder = entry.kind === "folder";
  const Item = menu === "context" ? ContextMenuItem : DropdownMenuItem;
  const Separator = menu === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
  return (
    <>
      <Item onClick={() => handlers.openEntry(entry)}>
        <Eye className="h-4 w-4" />
        {isFolder ? "打开" : "预览"}
      </Item>
      {isFolder && (
        <>
          <Item onClick={() => handlers.requestCreateFolder(entry.path)}>
            <FolderPlus className="h-4 w-4" />
            新建子文件夹
          </Item>
          <Item onClick={() => handlers.requestUpload(entry.path)}>
            <Upload className="h-4 w-4" />
            上传文件
          </Item>
        </>
      )}
      <Item onClick={() => handlers.startMove(entry)}>
        <Move className="h-4 w-4" />
        移动
      </Item>
      <Item onClick={() => handlers.startRename(entry)}>
        <Pencil className="h-4 w-4" />
        重命名
      </Item>
      {canManageResource && (
        <Item onClick={() => handlers.joinKnowledge(entry)}>
          <Sparkles className="h-4 w-4" />
          加入 AI 知识
        </Item>
      )}
      <Separator />
      <Item
        variant="destructive"
        onClick={() =>
          isFolder
            ? handlers.requestDeleteFolder(entry)
            : canManageResource
              ? handlers.requestDeleteResource(entry)
              : handlers.requestDeleteFile(entry)
        }
      >
        <Trash2 className="h-4 w-4" />
        删除
      </Item>
    </>
  );
}

export function WorkspaceTree({
  entries,
  entriesByParent,
  collapsedPaths,
  selectedFolderPath,
  handlers,
}: WorkspaceTreeProps) {
  const renderEntry = (entry: WorkspaceEntry, depth: number): ReactNode => {
    const isFolder = entry.kind === "folder";
    const isCollapsed = collapsedPaths.has(entry.path);
    const children = entriesByParent.get(entry.path) ?? [];
    const canManageResource = entry.resource_id != null && (entry.kind === "blog" || entry.kind === "file");

    return (
      <div key={entry.path}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className={cn(
                "group flex h-8 items-center gap-1 rounded-control pr-1 text-body text-foreground hover:bg-accent",
                isFolder && "cursor-pointer",
                selectedFolderPath === entry.path && "bg-accent",
              )}
              style={{ paddingLeft: `${depth * 14 + 8}px` }}
              draggable
              onDragStart={(event) => event.dataTransfer.setData("text/workspace-path", entry.path)}
              onDragOver={(event) => {
                if (isFolder) event.preventDefault();
              }}
              onDrop={(event) => {
                if (!isFolder) return;
                event.preventDefault();
                const sourcePath = event.dataTransfer.getData("text/workspace-path");
                if (sourcePath) handlers.moveFromDrop(sourcePath, entry.path);
              }}
              onClick={() => handlers.openEntry(entry)}
            >
              {isFolder ? (
                <button
                  type="button"
                  aria-label={isCollapsed ? "展开文件夹" : "折叠文件夹"}
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded hover:bg-background/70"
                  onClick={(event) => {
                    event.stopPropagation();
                    handlers.toggleFolder(entry.path);
                  }}
                >
                  <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", !isCollapsed && "rotate-90")} />
                </button>
              ) : (
                <span className="w-5 flex-shrink-0" />
              )}
              {entryIcon(entry)}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.kind === "blog" && (
                <span className="text-caption text-muted-foreground">{entry.blog_status === "published" ? "发布" : "草稿"}</span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${entry.name} 操作`}
                    className="hidden h-6 w-6 items-center justify-center rounded-control text-muted-foreground hover:bg-background hover:text-foreground group-hover:flex"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <EntryMenuItems menu="dropdown" entry={entry} handlers={handlers} canManageResource={canManageResource} />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-40">
            <EntryMenuItems menu="context" entry={entry} handlers={handlers} canManageResource={canManageResource} />
          </ContextMenuContent>
        </ContextMenu>
        {isFolder && !isCollapsed && children.map((child) => renderEntry(child, depth + 1))}
      </div>
    );
  };

  return <>{entries.map((entry) => renderEntry(entry, 0))}</>;
}
