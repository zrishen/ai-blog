import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Eye,
  FileText,
  Folder,
  FolderPlus,
  LayoutDashboard,
  MoreHorizontal,
  Move,
  Pencil,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";

import { useChat } from "../../stores/chatStore";

import { DeleteResourceDialog, type DeleteResourceTarget } from "./components/DeleteResourceDialog";

import type { LucideIcon } from "lucide-react";
import type { WorkspaceView } from "../../stores/types";

import { getBlogPost } from "@/api/blog";
import { listFileDocuments } from "@/api/files";
import {
  createFolder as createWorkspaceFolder,
  deleteUnmanagedWorkspaceFile,
  deleteFolder,
  getWorkspaceTree,
  joinAiKnowledge,
  moveEntry,
  renameEntry,
  type WorkspaceEntry,
} from "@/api/workspace";
import { BlogIcon, PublishedIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { errorMessage } from "@/lib/errors";
import { parentPath } from "@/lib/path";
import { useFileProcessing } from "./providers/FileProcessingProvider";


interface ViewItem {
  key: WorkspaceView;
  label: string;
  icon: LucideIcon;
}

const TYPE_VIEWS: ViewItem[] = [
  { key: "overview", label: "全部", icon: LayoutDashboard },
  { key: "drafts", label: "草稿", icon: FileText },
  { key: "published", label: "已发布", icon: CheckCircle2 },
  { key: "ai_knowledge", label: "AI 知识", icon: Sparkles },
  { key: "trash", label: "回收站", icon: Trash2 },
];

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

function NavItem({ item, active, onClick }: { item: ViewItem; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-body transition-colors",
        active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="truncate">{item.label}</span>
    </button>
  );
}

export function WorkspaceNav() {
  const { state, dispatch } = useChat();
  const { startUpload } = useFileProcessing();
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("workspace:collapsed-paths") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const [folderDraftParent, setFolderDraftParent] = useState<string | null | undefined>(undefined);
  const [folderName, setFolderName] = useState("");
  const [moveTarget, setMoveTarget] = useState<WorkspaceEntry | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<WorkspaceEntry | null>(null);
  const [deleteFileTarget, setDeleteFileTarget] = useState<WorkspaceEntry | null>(null);
  const [deleteResourceTarget, setDeleteResourceTarget] = useState<DeleteResourceTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadTargetRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const tree = await getWorkspaceTree();
      dispatch({ type: "SET_WORKSPACE_TREE", payload: tree });
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason, "加载工作区失败"));
    }
  }, [dispatch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reload, state.fileLibraryRevision, state.trashRevision]);

  useEffect(() => {
    try {
      localStorage.setItem("workspace:collapsed-paths", JSON.stringify([...collapsedPaths]));
    } catch {
      /* Ignore unavailable browser storage. */
    }
  }, [collapsedPaths]);

  const entriesByParent = useMemo(() => {
    const grouped = new Map<string | null, WorkspaceEntry[]>();
    for (const entry of state.workspaceTree) {
      const parent = parentPath(entry.path);
      grouped.set(parent, [...(grouped.get(parent) ?? []), entry]);
    }
    for (const children of grouped.values()) {
      children.sort((left, right) => {
        if (left.kind === "folder" && right.kind !== "folder") return -1;
        if (left.kind !== "folder" && right.kind === "folder") return 1;
        return left.name.localeCompare(right.name, "zh-CN");
      });
    }
    return grouped;
  }, [state.workspaceTree]);

  const folders = useMemo(
    () => state.workspaceTree.filter((entry) => entry.kind === "folder"),
    [state.workspaceTree],
  );

  const selectView = (view: WorkspaceView) => {
    dispatch({ type: "SET_WORKSPACE_SELECTED_VIEW", payload: view });
    dispatch({ type: "SET_WORKSPACE_SELECTED_FOLDER_PATH", payload: null });
    dispatch({ type: "SET_WORKSPACE_EDITING_BLOG", payload: null });
    dispatch({ type: "SET_FILE_SELECTED_FILE", payload: null });
  };

  const selectFolder = (path: string) => {
    dispatch({ type: "SET_WORKSPACE_SELECTED_FOLDER_PATH", payload: path });
    dispatch({ type: "SET_WORKSPACE_EDITING_BLOG", payload: null });
    dispatch({ type: "SET_FILE_SELECTED_FILE", payload: null });
  };

  const toggleFolder = (path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openEntry = async (entry: WorkspaceEntry) => {
    if (entry.kind === "folder") {
      selectFolder(entry.path);
      return;
    }
    if (entry.kind === "blog" && entry.resource_id != null) {
      try {
        const post = await getBlogPost(entry.resource_id);
        dispatch({ type: "UPSERT_BLOG_POST", payload: post });
      } catch {
        setError("无法打开文章，请刷新后重试");
        return;
      }
      dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: entry.resource_id });
      dispatch({ type: "SET_WORKSPACE_EDITING_BLOG", payload: entry.resource_id });
      dispatch({ type: "SET_WORKSPACE_SELECTED_FOLDER_PATH", payload: null });
      return;
    }
    dispatch({ type: "SET_FILE_SELECTED_FILE", payload: entry.path });
    dispatch({ type: "SET_WORKSPACE_SELECTED_FOLDER_PATH", payload: null });
  };

  const createFolder = async () => {
    const name = folderName.trim();
    if (!name || folderDraftParent === undefined) return;
    try {
      const entry = await createWorkspaceFolder(name, folderDraftParent);
      setCollapsedPaths((current) => {
        const next = new Set(current);
        if (folderDraftParent) next.delete(folderDraftParent);
        return next;
      });
      setFolderDraftParent(undefined);
      setFolderName("");
      await reload();
      selectFolder(entry.path);
    } catch (reason) {
      setError(errorMessage(reason, "新建文件夹失败"));
    }
  };

  const requestCreateFolder = (parent: string | null) => {
    setFolderName("");
    setFolderDraftParent(parent);
  };

  const rename = async (entry: WorkspaceEntry) => {
    const name = window.prompt("新名称", entry.name)?.trim();
    if (!name || name === entry.name) return;
    try {
      await renameEntry(entry.path, name);
      await reload();
    } catch (reason) {
      setError(errorMessage(reason, "重命名失败"));
    }
  };

  const move = async (targetPath: string | null) => {
    if (!moveTarget || targetPath === moveTarget.path || parentPath(moveTarget.path) === targetPath) return;
    try {
      await moveEntry(moveTarget.path, targetPath);
      setMoveTarget(null);
      await reload();
    } catch (reason) {
      setError(errorMessage(reason, "移动失败"));
    }
  };

  const moveFromDrop = async (sourcePath: string, targetPath: string) => {
    if (sourcePath === targetPath || parentPath(sourcePath) === targetPath) return;
    try {
      await moveEntry(sourcePath, targetPath);
      setCollapsedPaths((current) => {
        const next = new Set(current);
        next.delete(targetPath);
        return next;
      });
      await reload();
    } catch (reason) {
      setError(errorMessage(reason, "移动失败"));
    }
  };

  const deleteFolderEntry = async () => {
    if (!deleteFolderTarget) return;
    try {
      await deleteFolder(deleteFolderTarget.path);
      if (state.workspaceSelectedFolderPath === deleteFolderTarget.path) {
        dispatch({ type: "SET_WORKSPACE_SELECTED_FOLDER_PATH", payload: null });
      }
      setDeleteFolderTarget(null);
      await reload();
    } catch (reason) {
      setError(errorMessage(reason, "删除文件夹失败"));
    }
  };

  const deleteUnmanagedFile = async () => {
    if (!deleteFileTarget) return;
    try {
      await deleteUnmanagedWorkspaceFile(deleteFileTarget.path);
      if (state.fileSelectedFile === deleteFileTarget.path) {
        dispatch({ type: "SET_FILE_SELECTED_FILE", payload: null });
      }
      setDeleteFileTarget(null);
      await reload();
    } catch (reason) {
      setError(errorMessage(reason, "删除文件失败"));
    }
  };

  const joinKnowledge = async (entry: WorkspaceEntry) => {
    if (!entry.resource_type || entry.resource_id == null) return;
    try {
      await joinAiKnowledge(entry.resource_type, entry.resource_id);
      dispatch({ type: "INCREMENT_AI_KNOWLEDGE_REVISION" });
    } catch (reason) {
      setError(errorMessage(reason, "加入 AI 知识失败"));
    }
  };

  const requestUpload = (targetPath: string | null) => {
    uploadTargetRef.current = targetPath;
    fileInputRef.current?.click();
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const targetPath = uploadTargetRef.current;
    uploadTargetRef.current = null;
    for (const file of files) {
      try {
        const job = await startUpload(file);
        if (!job?.result_document_id || !targetPath) continue;
        const documents = await listFileDocuments();
        const document = documents.documents.find((item) => item.id === job.result_document_id);
        if (document) await moveEntry(document.file_path, targetPath);
      } catch (reason) {
        setError(errorMessage(reason, "文件处理失败"));
      }
    }
    await reload();
  };

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
                state.workspaceSelectedFolderPath === entry.path && "bg-accent",
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
                if (sourcePath) void moveFromDrop(sourcePath, entry.path);
              }}
              onClick={() => void openEntry(entry)}
            >
              {isFolder ? (
                <button
                  type="button"
                  aria-label={isCollapsed ? "展开文件夹" : "折叠文件夹"}
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded hover:bg-background/70"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFolder(entry.path);
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
                  <EntryMenuItems
                    menu="dropdown"
                    entry={entry}
                    onOpen={() => void openEntry(entry)}
                    onNewFolder={() => requestCreateFolder(entry.path)}
                    onUpload={() => requestUpload(entry.path)}
                    onMove={() => setMoveTarget(entry)}
                    onRename={() => void rename(entry)}
                    onDeleteFolder={() => setDeleteFolderTarget(entry)}
                    onDeleteFile={() => setDeleteFileTarget(entry)}
                    onDeleteResource={() =>
                      entry.resource_id != null &&
                      setDeleteResourceTarget({
                        type: entry.kind === "blog" ? "blog_post" : "file",
                        id: entry.resource_id,
                        name: entry.name,
                      })
                    }
                    onJoinKnowledge={() => void joinKnowledge(entry)}
                    canManageResource={canManageResource}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-40">
            <EntryMenuItems
              menu="context"
              entry={entry}
              onOpen={() => void openEntry(entry)}
              onNewFolder={() => requestCreateFolder(entry.path)}
              onUpload={() => requestUpload(entry.path)}
              onMove={() => setMoveTarget(entry)}
              onRename={() => void rename(entry)}
              onDeleteFolder={() => setDeleteFolderTarget(entry)}
              onDeleteFile={() => setDeleteFileTarget(entry)}
              onDeleteResource={() =>
                entry.resource_id != null &&
                setDeleteResourceTarget({
                  type: entry.kind === "blog" ? "blog_post" : "file",
                  id: entry.resource_id,
                  name: entry.name,
                })
              }
              onJoinKnowledge={() => void joinKnowledge(entry)}
              canManageResource={canManageResource}
            />
          </ContextMenuContent>
        </ContextMenu>
        {isFolder && !isCollapsed && children.map((child) => renderEntry(child, depth + 1))}
      </div>
    );
  };

  return (
    <WorkspacePanel className="overflow-y-auto select-none">
      <div className="flex min-h-0 flex-1 flex-col p-3">
        {TYPE_VIEWS.map((item) => (
          <NavItem
            key={item.key}
            item={item}
            active={state.workspaceSelectedFolderPath === null && state.workspaceSelectedView === item.key}
            onClick={() => selectView(item.key)}
          />
        ))}

        <div className="my-3 border-t border-border/70" />

        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-meta font-semibold text-muted-foreground">文件夹</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => requestCreateFolder(null)}
            aria-label="新建文件夹"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
        </div>

        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {(entriesByParent.get(null) ?? []).map((entry) => renderEntry(entry, 0))}
              {(entriesByParent.get(null) ?? []).length === 0 && (
                <p className="px-3 py-8 text-center text-meta leading-relaxed text-muted-foreground">
                  右键此处可新建文件夹或上传文件
                </p>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-40">
            <ContextMenuItem onClick={() => requestCreateFolder(null)}>
              <FolderPlus className="h-4 w-4" />
              新建文件夹
            </ContextMenuItem>
            <ContextMenuItem onClick={() => requestUpload(null)}>
              <Upload className="h-4 w-4" />
              上传文件
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>

      {error && <p className="px-3 pb-3 text-meta text-destructive">{error}</p>}
      <input ref={fileInputRef} type="file" accept=".pdf,.docx,.xlsx" multiple hidden onChange={(event) => void onFileChange(event)} />

      <Dialog open={folderDraftParent !== undefined} onOpenChange={(open) => !open && setFolderDraftParent(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
            <DialogDescription>文件夹会直接创建在当前用户的真实工作目录中。</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createFolder();
            }}
            placeholder="文件夹名称"
            className="text-reading md:text-body"
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={() => void createFolder()} disabled={!folderName.trim()}>
              新建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveTarget !== null} onOpenChange={(open) => !open && setMoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移动到文件夹</DialogTitle>
            <DialogDescription>移动会直接调整真实工作目录中的位置。</DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto rounded-control border border-border p-1">
            <Button
              variant="ghost"
              className="h-8 w-full justify-start text-body"
              onClick={() => void move(null)}
              disabled={parentPath(moveTarget?.path ?? "") === null}
            >
              <Folder className="h-4 w-4 text-primary" />
              工作区根目录
            </Button>
            {folders.map((folder) => (
              <Button
                key={folder.path}
                variant="ghost"
                className="h-8 w-full justify-start text-body"
                style={{ paddingLeft: `${(folder.path.split("/").length - 1) * 14 + 8}px` }}
                onClick={() => void move(folder.path)}
                disabled={folder.path === moveTarget?.path || parentPath(moveTarget?.path ?? "") === folder.path}
              >
                <Folder className="h-4 w-4 text-primary" />
                {folder.name}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteFolderTarget !== null} onOpenChange={(open) => !open && setDeleteFolderTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除文件夹</DialogTitle>
            <DialogDescription>仅可删除空文件夹；含内容的文件夹请先移动或删除其中的条目。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => void deleteFolderEntry()}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteFileTarget !== null} onOpenChange={(open) => !open && setDeleteFileTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除文件</DialogTitle>
            <DialogDescription>文件会移入工作区回收站，可以在回收站恢复。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => void deleteUnmanagedFile()}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteResourceDialog
        target={deleteResourceTarget}
        onClose={() => {
          setDeleteResourceTarget(null);
          void reload();
        }}
      />
    </WorkspacePanel>
  );
}

function EntryMenuItems({
  menu,
  entry,
  onOpen,
  onNewFolder,
  onUpload,
  onMove,
  onRename,
  onDeleteFolder,
  onDeleteFile,
  onDeleteResource,
  onJoinKnowledge,
  canManageResource,
}: {
  menu: "dropdown" | "context";
  entry: WorkspaceEntry;
  onOpen: () => void;
  onNewFolder: () => void;
  onUpload: () => void;
  onMove: () => void;
  onRename: () => void;
  onDeleteFolder: () => void;
  onDeleteFile: () => void;
  onDeleteResource: () => void;
  onJoinKnowledge: () => void;
  canManageResource: boolean;
}) {
  const isFolder = entry.kind === "folder";
  const Item = menu === "context" ? ContextMenuItem : DropdownMenuItem;
  const Separator = menu === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
  return (
    <>
      <Item onClick={onOpen}>
        <Eye className="h-4 w-4" />
        {isFolder ? "打开" : "预览"}
      </Item>
      {isFolder && (
        <>
          <Item onClick={onNewFolder}>
            <FolderPlus className="h-4 w-4" />
            新建子文件夹
          </Item>
          <Item onClick={onUpload}>
            <Upload className="h-4 w-4" />
            上传文件
          </Item>
        </>
      )}
      <Item onClick={onMove}>
        <Move className="h-4 w-4" />
        移动
      </Item>
      <Item onClick={onRename}>
        <Pencil className="h-4 w-4" />
        重命名
      </Item>
      {canManageResource && (
        <Item onClick={onJoinKnowledge}>
          <Sparkles className="h-4 w-4" />
          加入 AI 知识
        </Item>
      )}
      <Separator />
      <Item
        variant="destructive"
        onClick={isFolder ? onDeleteFolder : canManageResource ? onDeleteResource : onDeleteFile}
      >
        <Trash2 className="h-4 w-4" />
        删除
      </Item>
    </>
  );
}
