import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "../../stores/chatStore";
import { useAuth } from "../../stores/authStore";
import {
  listFileCategories,
  listFileDocuments,
  createFileCategory,
  deleteFileCategory,
  updateFileCategory,
  uploadToFileLibrary,
} from "../../api/client";
import { FolderOpen } from "lucide-react";
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
import { getFileIcon } from "./fileIcons";
import {
  isDescOf,
  findCategoryById,
  type EditingState,
} from "./fileCategoryUtils";
import { CategoryTree } from "./fileCategoryTree";

export function FilePanel() {
  const { state, dispatch } = useChat();
  const { isAuthenticated } = useAuth();
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<
    Set<number>
  >(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadCategoryRef = useRef<number | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [uploadTarget, setUploadTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [editingState, setEditingState] = useState<EditingState | null>(null);

  const [dragCategoryId, setDragCategoryId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);

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

  const loadFileDocs = useCallback(
    async (categoryId: number | null) => {
      if (!isAuthenticated) return;
      try {
        const data = await listFileDocuments(categoryId ?? undefined);
        dispatch({ type: "SET_FILE_DOCUMENTS", payload: data.documents });
      } catch (e) {
        console.error("Failed to load file documents:", e);
        setFileActionError(e instanceof Error ? e.message : "文件库加载失败");
      }
    },
    [dispatch, isAuthenticated]
  );

  useEffect(() => {
    if (state.currentPage === "files" && isAuthenticated) {
      // 异步加载文件库；rule 无法识别 useCallback 内的同步 setState 是异步链入口
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadFileDocs(state.fileSelectedCategoryId);
    }
  }, [isAuthenticated, state.currentPage, state.fileSelectedCategoryId, loadFileDocs]);

  const handleCategorySelect = (id: number | null) => {
    dispatch({ type: "SET_FILE_SELECTED_CATEGORY_ID", payload: id });
    dispatch({ type: "SET_FILE_SELECTED_FILE", payload: null });
  };

  const handleCategoryToggle = (id: number) => {
    setExpandedCategoryIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
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
      await loadFileDocs(
        state.fileSelectedCategoryId === id ? null : state.fileSelectedCategoryId
      );
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
    const { type, categoryId } = editingState;
    setEditingState(null);
    try {
      if (type === "rename") {
        await updateFileCategory(categoryId, { name: trimmed });
      } else {
        await createFileCategory({ name: trimmed, parent_id: categoryId });
      }
      await loadFileCats();
      if (type === "newSub") {
        setExpandedCategoryIds((prev) => {
          const next = new Set(prev);
          next.add(categoryId);
          return next;
        });
      }
    } catch (e) {
      console.error(`Failed to ${type === "rename" ? "rename" : "create"} category:`, e);
    }
  };

  const handleEditingCancel = () => {
    setEditingState(null);
  };

  const handleDropOnCategory = useCallback(
    async (sourceId: number, targetId: number) => {
      setDropTargetId(null);
      if (sourceId === targetId) return;
      if (isDescOf(targetId, sourceId, state.fileCategories)) return;
      const source = findCategoryById(sourceId, state.fileCategories);
      if (!source) return;
      try {
        await updateFileCategory(sourceId, { name: source.name, parent_id: targetId });
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
    [state.fileCategories, loadFileCats]
  );

  const handleDropOnRoot = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const sourceId = Number(e.dataTransfer.getData("text/plain"));
      if (!sourceId) return;
      const source = findCategoryById(sourceId, state.fileCategories);
      if (!source) return;
      try {
        await updateFileCategory(sourceId, { name: source.name, parent_id: null });
        await loadFileCats();
      } catch (err) {
        console.error("Failed to move category to root:", err);
      }
    },
    [loadFileCats, state.fileCategories]
  );

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const categoryId = pendingUploadCategoryRef.current;
    try {
      setFileActionError(null);
      await uploadToFileLibrary(file, categoryId ?? undefined);
      if (categoryId !== state.fileSelectedCategoryId) {
        dispatch({ type: "SET_FILE_SELECTED_CATEGORY_ID", payload: categoryId });
      }
      await loadFileDocs(categoryId);
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
      <aside className="w-full h-full bg-card/82 backdrop-blur-xl border-r border-border/80 flex flex-col overflow-y-auto select-none shadow-[12px_0_35px_hsl(var(--foreground)/0.03)]" />
    );
  }

  return (
    <aside className="w-full h-full bg-card/82 backdrop-blur-xl border-r border-border/80 flex flex-col overflow-y-auto select-none shadow-[12px_0_35px_hsl(var(--foreground)/0.03)]">
      <div className="p-4 flex flex-col gap-3">
        {fileActionError && (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-[13px] leading-relaxed text-destructive">
            {fileActionError}
          </div>
        )}
        <Button
          variant={
            state.fileSelectedCategoryId === null ? "secondary" : "ghost"
          }
          className={`justify-start text-[13px] px-3 py-2.5 rounded-xl h-auto font-semibold gap-2 transition-all hover:translate-x-0.5 ${
            state.fileSelectedCategoryId === null ? "bg-primary/10 text-primary shadow-sm" : ""
          } ${dropTargetId === -1 ? "ring-2 ring-primary/60 bg-primary/12 shadow-md shadow-primary/10" : ""}`}
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
          全部分类
        </Button>
        {state.fileCategories.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/50 px-3 py-4 text-[13px] text-muted-foreground">
            暂无分类，右键或在主界面新建
          </div>
        )}
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
          onDropTargetChange={setDropTargetId}
        />

        <div className="flex items-center justify-between mt-4 mb-1">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-bold">
            文件
          </div>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
            {state.fileDocuments.length}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {state.fileDocuments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/50 px-3 py-4 text-center text-[13px] text-muted-foreground">暂无文件</div>
          ) : (
            state.fileDocuments.map((doc) => (
              <Button
                key={doc.id}
                variant={
                  state.fileSelectedFile === doc.file_path
                    ? "secondary"
                    : "ghost"
                }
                className="justify-start text-[13px] px-3 py-2 rounded-xl h-auto font-medium gap-2 truncate transition-all hover:translate-x-0.5 hover:bg-primary/8"
                onClick={() => handleFileSelect(doc.file_path)}
                title={doc.original_name}
              >
                {getFileIcon(doc.original_name)}
                {doc.original_name.length > 20
                  ? doc.original_name.substring(0, 20) + "..."
                  : doc.original_name}
              </Button>
            ))
          )}
        </div>
      </div>
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
              确定要删除分类「{deleteTarget?.name}」吗？其中的文档将移出分类。
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
              将文件上传到分类「{uploadTarget?.name}」
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={handleUploadFilePick}>选择文件</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
