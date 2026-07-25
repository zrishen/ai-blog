import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "../../../stores/chatStore";
import { useAuth } from "../../../stores/authStore";
import type { FileDocument } from "../../../stores/chatStore";
import {
  listFileCategories,
  listFileDocuments,
  createFileCategory,
  deleteFileCategory,
  updateFileCategory,
  setDocumentCategory,
  deleteFileDocument,
  updateFileDocument,
} from "../../../api/client";
import { useFileProcessing } from "../../../features/file-processing/FileProcessingProvider";
import { FolderOpen, FolderPlus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/select";
import { WorkspacePanel } from "@/components/ui/workspace-panel";
import {
  groupByCategory,
  isDescOf,
  findCategoryById,
  flattenCategories,
  type EditingState,
} from "../utils/fileCategoryUtils";
import { CategoryTree, FileNode } from "./fileCategoryTree";
import { parseDragSource } from "../utils/dragSource";

interface MoveTarget {
  kind: "file" | "category";
  id: number;
  name: string;
}

export function FilePanel() {
  const { state, dispatch } = useChat();
  const { isAuthenticated } = useAuth();
  const { isUploadActive, startUpload, clearUploadError } = useFileProcessing();
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<
    Set<string | number>
  >(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadCategoryRef = useRef<number | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [uploadTarget, setUploadTarget] = useState<{
    id: number | null;
    name: string;
  } | null>(null);
  const [newRootOpen, setNewRootOpen] = useState(false);
  const [newRootName, setNewRootName] = useState("");
  const [editingState, setEditingState] = useState<EditingState | null>(null);

  const [dragCategoryId, setDragCategoryId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);

  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [moveTargetParentId, setMoveTargetParentId] = useState<number | null>(null);
  const [deleteFileTarget, setDeleteFileTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);

  const { byCategoryId: documentsByCategory, uncategorized: uncategorizedDocs } =
    useMemo(() => groupByCategory(state.fileDocuments), [state.fileDocuments]);

  const flatCategories = useMemo(
    () => flattenCategories(state.fileCategories),
    [state.fileCategories],
  );

  const loadFileCats = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const cats = await listFileCategories();
      dispatch({ type: "SET_FILE_CATEGORIES", payload: cats });
    } catch (e) {
      console.error("Failed to load file categories:", e);
    }
  }, [dispatch, isAuthenticated]);

  useEffect(() => {
    if (state.currentPage === "files" && isAuthenticated) {
      loadFileCats();
    }
  }, [isAuthenticated, state.currentPage, loadFileCats]);

  const loadFileDocs = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const data = await listFileDocuments();
      dispatch({ type: "SET_FILE_DOCUMENTS", payload: data.documents });
    } catch (e) {
      console.error("Failed to load file documents:", e);
      setFileActionError(e instanceof Error ? e.message : "文件库加载失败");
    }
  }, [dispatch, isAuthenticated]);

  useEffect(() => {
    if (state.currentPage === "files" && isAuthenticated) {
      // 异步加载文件库；rule 无法识别 useCallback 内的同步 setState 是异步链入口
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadFileDocs();
    }
  }, [isAuthenticated, state.currentPage, state.fileLibraryRevision, loadFileDocs]);

  const handleCategorySelect = (id: number | null) => {
    dispatch({ type: "SET_FILE_SELECTED_CATEGORY_ID", payload: id });
    dispatch({ type: "SET_FILE_SELECTED_FILE", payload: null });
  };

  const handleCategoryToggle = (id: number) => {
    setExpandedCategoryIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleFileSelect = (fileName: string) => {
    dispatch({ type: "SET_FILE_SELECTED_FILE", payload: fileName });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteFileCategory(id);
      if (state.fileSelectedCategoryId === id) {
        dispatch({ type: "SET_FILE_SELECTED_CATEGORY_ID", payload: null });
      }
      await loadFileCats();
      await loadFileDocs();
    } catch (e) {
      console.error("Failed to delete category:", e);
    }
  };

  const handleUploadFilePick = () => {
    if (!uploadTarget) return;
    const { id } = uploadTarget;
    pendingUploadCategoryRef.current = id;
    setUploadTarget(null);
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 100);
  };

  const handleConfirmNewRoot = async () => {
    const trimmed = newRootName.trim();
    if (!trimmed) {
      setNewRootOpen(false);
      return;
    }
    try {
      await createFileCategory({ name: trimmed, parent_id: null });
      await loadFileCats();
    } catch (e) {
      console.error("Failed to create root category:", e);
      setFileActionError(e instanceof Error ? e.message : "创建分类失败");
    } finally {
      setNewRootName("");
      setNewRootOpen(false);
    }
  };

  const handleEditingValueChange = (value: string) => {
    setEditingState((prev) => (prev ? { ...prev, value } : null));
  };

  const handleEditingSubmit = async () => {
    if (!editingState) return;
    const trimmed = editingState.value.trim();
    if (!trimmed) {
      setEditingState(null);
      return;
    }
    const state = editingState;
    setEditingState(null);
    try {
      if (state.type === "rename") {
        await updateFileCategory(state.categoryId, { name: trimmed });
        await loadFileCats();
      } else if (state.type === "renameFile") {
        await updateFileDocument(state.docId, trimmed);
        await loadFileDocs();
      } else {
        await createFileCategory({ name: trimmed, parent_id: state.categoryId });
        await loadFileCats();
        setExpandedCategoryIds((prev) => {
          const next = new Set(prev);
          next.add(state.categoryId);
          return next;
        });
      }
    } catch (e) {
      console.error(`Failed to ${state.type === "rename" ? "rename" : state.type === "renameFile" ? "rename file" : "create"}:`, e);
    }
  };

  const handleEditingCancel = () => {
    setEditingState(null);
  };

  const handleDropOnRoot = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("text/plain");
      const source = parseDragSource(raw);
      if (!source) return;
      if (source.kind === "file") {
        try {
          await setDocumentCategory(source.id, null);
          await loadFileDocs();
        } catch (err) {
          console.error("Failed to move file to uncategorized:", err);
        }
        return;
      }
      const sourceCat = findCategoryById(source.id, state.fileCategories);
      if (!sourceCat) return;
      try {
        await updateFileCategory(source.id, {
          name: sourceCat.name,
          parent_id: null,
        });
        await loadFileCats();
      } catch (err) {
        console.error("Failed to move category to root:", err);
      }
    },
    [loadFileCats, loadFileDocs, state.fileCategories],
  );

  const handleDropOnCategory = useCallback(
    async (sourceId: number, targetId: number) => {
      setDropTargetId(null);
      if (sourceId === targetId) return;
      if (isDescOf(targetId, sourceId, state.fileCategories)) return;
      const source = findCategoryById(sourceId, state.fileCategories);
      if (!source) return;
      try {
        await updateFileCategory(sourceId, {
          name: source.name,
          parent_id: targetId,
        });
        setExpandedCategoryIds((prev) => {
          const next = new Set(prev);
          next.add(targetId);
          return next;
        });
        await loadFileCats();
      } catch (e) {
        console.error("Failed to move category:", e);
      } finally {
        setDragCategoryId(null);
      }
    },
    [state.fileCategories, loadFileCats],
  );

  const handleDropFileOnCategory = useCallback(
    async (fileId: number, targetId: number) => {
      setDropTargetId(null);
      try {
        await setDocumentCategory(fileId, targetId);
        await loadFileDocs();
      } catch (e) {
        console.error("Failed to move file:", e);
      }
    },
    [loadFileDocs],
  );

  const handleConfirmMove = useCallback(async () => {
    if (!moveTarget) return;
    const target = moveTarget;
    const newParentId = moveTargetParentId;
    setMoveTarget(null);
    try {
      if (target.kind === "file") {
        await setDocumentCategory(target.id, newParentId);
        await loadFileDocs();
      } else {
        const sourceCat = findCategoryById(target.id, state.fileCategories);
        if (!sourceCat) return;
        if (
          newParentId !== null &&
          isDescOf(newParentId, target.id, state.fileCategories)
        )
          return;
        await updateFileCategory(target.id, {
          name: sourceCat.name,
          parent_id: newParentId,
        });
        if (newParentId !== null) {
          setExpandedCategoryIds((prev) => {
            const next = new Set(prev);
            next.add(newParentId);
            return next;
          });
        }
        await loadFileCats();
      }
    } catch (e) {
      console.error("Failed to move:", e);
    }
  }, [moveTarget, moveTargetParentId, state.fileCategories, loadFileCats, loadFileDocs]);

  const handleConfirmFileDelete = useCallback(async () => {
    if (!deleteFileTarget) return;
    const target = deleteFileTarget;
    setDeleteFileTarget(null);
    try {
      await deleteFileDocument(target.id);
      await loadFileDocs();
    } catch (e) {
      console.error("Failed to delete file:", e);
    }
  }, [deleteFileTarget, loadFileDocs]);

  const handleRequestFileMove = useCallback((doc: FileDocument) => {
    setMoveTarget({
      kind: "file",
      id: doc.id,
      name: doc.original_name,
    });
    setMoveTargetParentId(doc.category_id ?? null);
  }, []);

  const handleRequestFileRename = useCallback((doc: FileDocument) => {
    setEditingState({ type: "renameFile", docId: doc.id, value: doc.original_name });
  }, []);

  const handleRequestCategoryMove = useCallback(
    (id: number, name: string) => {
      const cat = findCategoryById(id, state.fileCategories);
      setMoveTarget({ kind: "category", id, name });
      setMoveTargetParentId(cat?.parent_id ?? null);
    },
    [state.fileCategories],
  );

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const categoryId = pendingUploadCategoryRef.current;
    try {
      setFileActionError(null);
      clearUploadError();
      if (categoryId !== state.fileSelectedCategoryId) {
        dispatch({ type: "SET_FILE_SELECTED_CATEGORY_ID", payload: categoryId });
      }
      await startUpload(file, categoryId ?? undefined);
    } catch (err) {
      console.error("Failed to upload file:", err);
      setFileActionError(err instanceof Error ? err.message : "文件库上传失败");
    } finally {
      pendingUploadCategoryRef.current = null;
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (!isAuthenticated) {
    return (
      <WorkspacePanel className="overflow-y-auto select-none" />
    );
  }

  const rootDropTarget = dropTargetId === -1;
  const rootSelected = state.fileSelectedCategoryId === null;
  const hasCategories = state.fileCategories.length > 0;
  const hasUncategorized = uncategorizedDocs.length > 0;
  const showEmptyPlaceholder = !hasCategories && !hasUncategorized;
  const moveCategoryExcludeId =
    moveTarget?.kind === "category" ? moveTarget.id : undefined;

  return (
    <WorkspacePanel className="overflow-hidden select-none">
      <div className="p-3 flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2 md:hidden">
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setNewRootOpen(true)}>
            <FolderPlus className="h-4 w-4" />
            新建分类
          </Button>
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setUploadTarget({ id: null, name: "全部分类" })}>
            <Upload className="h-4 w-4" />
            上传文件
          </Button>
        </div>
        {fileActionError && (
          <Alert variant="destructive" className="px-3 py-2 text-[13px] leading-relaxed">
            {fileActionError}
          </Alert>
        )}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <Button
              variant={rootSelected ? "secondary" : "ghost"}
              className={`flex-1 justify-start text-[13px] px-3 py-2.5 rounded-xl h-auto font-semibold gap-2 transition-all hover:translate-x-0.5 ${
                rootSelected ? "bg-primary/10 text-primary shadow-sm" : ""
              } ${rootDropTarget ? "ring-2 ring-primary/60 bg-primary/12 shadow-md shadow-primary/10" : ""}`}
              onClick={() => handleCategorySelect(null)}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDropTargetId(-1);
              }}
              onDragLeave={(e) => {
                e.stopPropagation();
                setDropTargetId(null);
              }}
              onDrop={(e) => {
                e.stopPropagation();
                setDropTargetId(null);
                handleDropOnRoot(e);
              }}
            >
              <FolderOpen className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 truncate text-left">全部分类</span>
              {state.fileDocuments.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {state.fileDocuments.length}
                </span>
              )}
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-44">
            <ContextMenuItem onClick={() => setNewRootOpen(true)}>
              <FolderPlus className="w-4 h-4" />
              新建分类
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => setUploadTarget({ id: null, name: "全部分类" })}
            >
              <Upload className="w-4 h-4" />
              上传文件
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
      {showEmptyPlaceholder ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="flex-1 flex items-center justify-center px-6 text-center">
              <span className="text-base text-muted-foreground leading-relaxed">
                <span className="md:hidden">暂无分类，可使用上方按钮创建分类和上传文件</span>
                <span className="hidden md:inline">暂无分类，右键可创建分类和上传文件</span>
              </span>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-44">
            <ContextMenuItem onClick={() => setNewRootOpen(true)}>
              <FolderPlus className="w-4 h-4" />
              新建分类
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => setUploadTarget({ id: null, name: "全部分类" })}
            >
              <Upload className="w-4 h-4" />
              上传文件
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="flex-1 overflow-y-auto px-3 pt-px pb-3">
              {hasCategories && (
                <CategoryTree
                  categories={state.fileCategories}
                  selectedId={state.fileSelectedCategoryId}
                  expandedIds={expandedCategoryIds}
                  onSelect={(id) => handleCategorySelect(id)}
                  onToggle={handleCategoryToggle}
                  onRequestDelete={(id, name) => setDeleteTarget({ id, name })}
                  onRequestNewSub={(parentId) => {
                    setExpandedCategoryIds((prev) => {
                      const next = new Set(prev);
                      next.add(parentId);
                      return next;
                    });
                    setEditingState({
                      type: "newSub",
                      categoryId: parentId,
                      value: "",
                    });
                  }}
                  onRequestUpload={(id, name) => setUploadTarget({ id, name })}
                  onRequestRename={(id, currentName) =>
                    setEditingState({
                      type: "rename",
                      categoryId: id,
                      value: currentName,
                    })
                  }
                  onRequestMove={handleRequestCategoryMove}
                  onRequestFileDelete={(doc) =>
                    setDeleteFileTarget({
                      id: doc.id,
                      name: doc.original_name,
                    })
                  }
                  onRequestFileMove={handleRequestFileMove}
                  onRequestFileRename={handleRequestFileRename}
                  editingState={editingState}
                  onEditingValueChange={handleEditingValueChange}
                  onEditingSubmit={handleEditingSubmit}
                  onEditingCancel={handleEditingCancel}
                  dragCategoryId={dragCategoryId}
                  dropTargetId={dropTargetId}
                  onDragStart={setDragCategoryId}
                  onDragEnd={() => {
                    setDragCategoryId(null);
                    setDropTargetId(null);
                  }}
                  onDropOnCategory={handleDropOnCategory}
                  onDropFileOnCategory={handleDropFileOnCategory}
                  onDropTargetChange={setDropTargetId}
                  documentsByCategory={documentsByCategory}
                  selectedFile={state.fileSelectedFile}
                  onSelectFile={handleFileSelect}
                />
              )}
              {uncategorizedDocs.map((doc) => (
                <FileNode
                  key={`uncat-${doc.id}`}
                  doc={doc}
                  depth={-1}
                  selectedFile={state.fileSelectedFile}
                  onSelectFile={handleFileSelect}
                  onRequestDelete={(d) =>
                    setDeleteFileTarget({ id: d.id, name: d.original_name })
                  }
                  onRequestMove={handleRequestFileMove}
                  onRequestRename={handleRequestFileRename}
                  editingState={editingState}
                  onEditingValueChange={handleEditingValueChange}
                  onEditingSubmit={handleEditingSubmit}
                  onEditingCancel={handleEditingCancel}
                />
              ))}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-44">
            <ContextMenuItem onClick={() => setNewRootOpen(true)}>
              <FolderPlus className="w-4 h-4" />
              新建分类
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => setUploadTarget({ id: null, name: "全部分类" })}
            >
              <Upload className="w-4 h-4" />
              上传文件
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除分类「{deleteTarget?.name}」吗？其下所有子分类将一并删除，分类内文档也将删除（可在回收站恢复）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={uploadTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUploadTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>上传文件</DialogTitle>
            <DialogDescription>
              {uploadTarget?.id === null
                ? "将文件上传为未分类文档"
                : `将文件上传到分类「${uploadTarget?.name}」`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={handleUploadFilePick} disabled={isUploadActive}>
              选择文件
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={newRootOpen}
        onOpenChange={(open) => {
          if (!open) {
            setNewRootName("");
            setNewRootOpen(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建分类</DialogTitle>
            <DialogDescription>在顶层创建一个新的分类。</DialogDescription>
          </DialogHeader>
          <Input
            value={newRootName}
            onChange={(e) => setNewRootName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirmNewRoot();
            }}
            placeholder="分类名称"
            autoFocus
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={handleConfirmNewRoot}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={moveTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMoveTarget(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              移动{moveTarget?.kind === "file" ? "文件" : "分类"}
            </DialogTitle>
            <DialogDescription>
              将「{moveTarget?.name}」移动到指定
              {moveTarget?.kind === "file" ? "分类" : "父分类"}。
            </DialogDescription>
          </DialogHeader>
          <Select
            className="h-10"
            value={moveTargetParentId === null ? "" : String(moveTargetParentId)}
            onChange={(e) =>
              setMoveTargetParentId(e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">
              {moveTarget?.kind === "file"
                ? "无分类（未分类）"
                : "无父分类（升为顶层）"}
            </option>
            {flatCategories
              .filter(
                (c) =>
                  moveCategoryExcludeId === undefined ||
                  c.id !== moveCategoryExcludeId,
              )
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {"　".repeat(c._depth)}
                  {c.name}
                </option>
              ))}
          </Select>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={handleConfirmMove}>移动</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteFileTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteFileTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除文件</DialogTitle>
            <DialogDescription>
              确定要删除「{deleteFileTarget?.name}」吗？删除后可在回收站恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleConfirmFileDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspacePanel>
  );
}
