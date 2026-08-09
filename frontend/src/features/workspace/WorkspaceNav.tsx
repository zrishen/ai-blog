import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, FileText, Folder, FolderPlus, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createFolder,
  deleteFolder,
  getWorkspaceTree,
  moveEntry,
  renameEntry,
  type WorkspaceEntry,
} from "@/api/workspace";
import { cn } from "@/lib/utils";
import { useChat } from "../../stores/chatStore";

function parentPath(path: string): string | null {
  const index = path.lastIndexOf("/");
  return index < 0 ? null : path.slice(0, index);
}

function childrenByParent(entries: WorkspaceEntry[]) {
  const byParent = new Map<string | null, WorkspaceEntry[]>();
  for (const entry of entries) {
    const parent = parentPath(entry.path);
    byParent.set(parent, [...(byParent.get(parent) ?? []), entry]);
  }
  for (const children of byParent.values()) {
    children.sort((left, right) => {
      if (left.kind === "folder" && right.kind !== "folder") return -1;
      if (left.kind !== "folder" && right.kind === "folder") return 1;
      return left.name.localeCompare(right.name, "zh-CN");
    });
  }
  return byParent;
}

export function WorkspaceNav() {
  const { state, dispatch } = useChat();
  const entries = state.workspaceTree;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [newFolderName, setNewFolderName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const tree = await getWorkspaceTree();
      dispatch({ type: "SET_WORKSPACE_TREE", payload: tree });
      setExpanded((current) => new Set([...current, ...tree.filter((entry) => entry.kind === "folder").map((entry) => entry.path)]));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加载工作区失败");
    }
  }, [dispatch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const byParent = useMemo(() => childrenByParent(entries), [entries]);

  const addRootFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await createFolder(name);
      setNewFolderName("");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建文件夹失败");
    }
  };

  const rename = async (entry: WorkspaceEntry) => {
    const name = window.prompt("新名称", entry.name)?.trim();
    if (!name || name === entry.name) return;
    try {
      await renameEntry(entry.path, name);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重命名失败");
    }
  };

  const addChild = async (entry: WorkspaceEntry) => {
    const name = window.prompt("文件夹名称")?.trim();
    if (!name) return;
    try {
      await createFolder(name, entry.path);
      setExpanded((current) => new Set(current).add(entry.path));
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建文件夹失败");
    }
  };

  const remove = async (entry: WorkspaceEntry) => {
    if (!window.confirm(`删除空文件夹“${entry.name}”？`)) return;
    try {
      await deleteFolder(entry.path);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除文件夹失败");
    }
  };

  const moveToFolder = async (sourcePath: string, targetPath: string) => {
    if (sourcePath === targetPath || parentPath(sourcePath) === targetPath) return;
    try {
      await moveEntry(sourcePath, targetPath);
      setExpanded((current) => new Set(current).add(targetPath));
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "移动失败");
    }
  };

  const renderEntry = (entry: WorkspaceEntry, depth: number) => {
    const isFolder = entry.kind === "folder";
    const children = byParent.get(entry.path) ?? [];
    const isExpanded = expanded.has(entry.path);
    return (
      <div key={entry.path}>
        <div
          className={cn(
            "group flex items-center gap-1 rounded-control py-1 text-body text-foreground hover:bg-accent",
            isFolder && "cursor-pointer",
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          draggable
          onDragStart={(event) => event.dataTransfer.setData("text/workspace-path", entry.path)}
          onDragOver={(event) => {
            if (isFolder) event.preventDefault();
          }}
          onDrop={(event) => {
            if (!isFolder) return;
            event.preventDefault();
            const sourcePath = event.dataTransfer.getData("text/workspace-path");
            if (sourcePath) void moveToFolder(sourcePath, entry.path);
          }}
          onClick={() => {
            if (isFolder) {
              setExpanded((current) => {
                const next = new Set(current);
                if (next.has(entry.path)) next.delete(entry.path);
                else next.add(entry.path);
                return next;
              });
            }
          }}
        >
          {isFolder ? (
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-90")} />
          ) : (
            <span className="w-3.5" />
          )}
          {isFolder ? <Folder className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
          {entry.kind === "blog" && <span className="text-fine text-muted-foreground">文章</span>}
          {isFolder && (
            <span className="hidden items-center gap-0.5 pr-1 group-hover:flex" onClick={(event) => event.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void addChild(entry)} aria-label="新建子文件夹">
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void rename(entry)} aria-label="重命名文件夹">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void remove(entry)} aria-label="删除空文件夹">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </span>
          )}
        </div>
        {isFolder && isExpanded && children.map((child) => renderEntry(child, depth + 1))}
      </div>
    );
  };

  return (
    <aside className="flex h-full flex-col gap-2 p-2">
      <div className="flex items-center gap-1">
        <Input
          value={newFolderName}
          onChange={(event) => setNewFolderName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addRootFolder();
          }}
          placeholder="新建文件夹"
          className="h-8 text-reading md:text-body"
        />
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => void addRootFolder()} aria-label="新建根文件夹">
          <FolderPlus className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="px-1 text-meta text-destructive">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto">{(byParent.get(null) ?? []).map((entry) => renderEntry(entry, 0))}</div>
    </aside>
  );
}
