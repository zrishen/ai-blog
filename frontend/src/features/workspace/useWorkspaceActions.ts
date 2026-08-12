import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import { useChat } from "../../stores/chatStore";

import type { WorkspaceView } from "../../stores/types";
import type { DeleteResourceTarget } from "./components/DeleteResourceDialog";
import type { WorkspaceTreeHandlers } from "./WorkspaceTree";

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
import { useFileProcessing } from "./providers/FileProcessingProvider";
import { errorMessage } from "@/lib/errors";



export function parentPath(path: string): string | null {
  const index = path.lastIndexOf("/");
  return index < 0 ? null : path.slice(0, index);
}

export function useWorkspaceActions() {
  const { state, dispatch } = useChat();
  const { startUpload } = useFileProcessing();
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("workspace:collapsed-paths") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  // 登出清理折叠状态：collapsedPaths 反映用户私有目录结构，跨账号共享设备时不能残留给下一用户
  useEffect(() => {
    const clearCollapsed = () => {
      setCollapsedPaths(new Set());
      try {
        localStorage.removeItem("workspace:collapsed-paths");
      } catch {
        /* Ignore unavailable browser storage. */
      }
    };
    window.addEventListener("auth:logout", clearCollapsed);
    return () => window.removeEventListener("auth:logout", clearCollapsed);
  }, []);

  const [folderDraftParent, setFolderDraftParent] = useState<string | null | undefined>(undefined);
  const [folderName, setFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<WorkspaceEntry | null>(null);
  const [renameName, setRenameName] = useState("");
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

  const runWithReload = async <T>(
    op: () => Promise<T>,
    fallback: string,
    onSuccess?: (result: T) => void,
  ): Promise<void> => {
    try {
      const result = await op();
      onSuccess?.(result);
      await reload();
    } catch (reason) {
      setError(errorMessage(reason, fallback));
    }
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

  const rename = async () => {
    if (!renameTarget) return;
    const name = renameName.trim();
    if (!name || name === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    await runWithReload(() => renameEntry(renameTarget.path, name), "重命名失败", () => {
      setRenameTarget(null);
    });
  };

  const move = async (targetPath: string | null) => {
    if (!moveTarget || targetPath === moveTarget.path || parentPath(moveTarget.path) === targetPath) return;
    await runWithReload(() => moveEntry(moveTarget.path, targetPath), "移动失败", () => {
      setMoveTarget(null);
    });
  };

  const moveFromDrop = async (sourcePath: string, targetPath: string) => {
    if (sourcePath === targetPath || parentPath(sourcePath) === targetPath) return;
    await runWithReload(() => moveEntry(sourcePath, targetPath), "移动失败", () => {
      setCollapsedPaths((current) => {
        const next = new Set(current);
        next.delete(targetPath);
        return next;
      });
    });
  };

  const deleteFolderEntry = async () => {
    if (!deleteFolderTarget) return;
    await runWithReload(() => deleteFolder(deleteFolderTarget.path), "删除文件夹失败", () => {
      if (state.workspaceSelectedFolderPath === deleteFolderTarget.path) {
        dispatch({ type: "SET_WORKSPACE_SELECTED_FOLDER_PATH", payload: null });
      }
      setDeleteFolderTarget(null);
    });
  };

  const deleteUnmanagedFile = async () => {
    if (!deleteFileTarget) return;
    await runWithReload(() => deleteUnmanagedWorkspaceFile(deleteFileTarget.path), "删除文件失败", () => {
      if (state.fileSelectedFile === deleteFileTarget.path) {
        dispatch({ type: "SET_FILE_SELECTED_FILE", payload: null });
      }
      setDeleteFileTarget(null);
    });
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

  const handlers: WorkspaceTreeHandlers = {
    openEntry: (entry) => void openEntry(entry),
    requestCreateFolder,
    requestUpload,
    startMove: (entry) => setMoveTarget(entry),
    startRename: (entry) => {
      setRenameName(entry.name);
      setRenameTarget(entry);
    },
    requestDeleteFolder: (entry) => setDeleteFolderTarget(entry),
    requestDeleteFile: (entry) => setDeleteFileTarget(entry),
    requestDeleteResource: (entry) => {
      if (entry.resource_id == null) return;
      setDeleteResourceTarget({
        type: entry.kind === "blog" ? "blog_post" : "file",
        id: entry.resource_id,
        name: entry.name,
      });
    },
    joinKnowledge: (entry) => void joinKnowledge(entry),
    moveFromDrop: (source, target) => void moveFromDrop(source, target),
    toggleFolder,
  };

  return {
    state,
    entriesByParent,
    folders,
    collapsedPaths,
    handlers,
    error,
    fileInputRef,
    onFileChange,
    selectView,
    requestCreateFolder,
    requestUpload,
    reload,
    folderDraftParent,
    folderName,
    setFolderName,
    setFolderDraftParent,
    createFolder,
    renameTarget,
    renameName,
    setRenameName,
    setRenameTarget,
    rename,
    moveTarget,
    setMoveTarget,
    move,
    deleteFolderTarget,
    setDeleteFolderTarget,
    deleteFolderEntry,
    deleteFileTarget,
    setDeleteFileTarget,
    deleteUnmanagedFile,
    deleteResourceTarget,
    setDeleteResourceTarget,
  };
}
