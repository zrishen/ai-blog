import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useChat } from "../../stores/chatStore";
import type { KBCategory } from "../../stores/chatStore";
import { useAuth } from "../../stores/authStore";
import { useChatHooks } from "../../hooks/useChat";
import { uploadToKB, createKBCategory, deleteKBDocument, setDocumentCategory, listKBCategories } from "../../api/client";
import { FilePreview } from "../../components/FilePreview";
import { motion } from "motion/react";
import { ArrowLeft, Upload, FolderPlus, X, Trash2, AlertCircle, FileText, FileSpreadsheet, File, Database, Sparkles, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { LoginDialog } from "../auth/LoginDialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function flattenCategories(cats: KBCategory[], depth = 0): (KBCategory & { _depth: number })[] {
  const result: (KBCategory & { _depth: number })[] = [];
  for (const cat of cats) {
    result.push({ ...cat, _depth: depth });
    if (cat.children?.length) {
      result.push(...flattenCategories(cat.children, depth + 1));
    }
  }
  return result;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function getDocumentIcon(fileName: string, className = "w-8 h-8") {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return <FileText className={`${className} text-red-500`} />;
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) return <FileText className={`${className} text-blue-500`} />;
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return <FileSpreadsheet className={`${className} text-green-500`} />;
  return <File className={`${className} text-muted-foreground`} />;
}

export function KnowledgeBasePage() {
  const { state, dispatch } = useChat();
  const { isAuthenticated } = useAuth();
  const { loadKBDocuments } = useChatHooks();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatParentId, setNewCatParentId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  const flatCategories = useMemo(() => flattenCategories(state.kbCategories), [state.kbCategories]);
  const categoryMap = useMemo(() => new Map(flatCategories.map((c) => [c.id, c.name])), [flatCategories]);
  const selectedCategoryName = state.kbSelectedCategoryId ? categoryMap.get(state.kbSelectedCategoryId) : "全部文件";

  useEffect(() => {
    if (!isAuthenticated) return;
    if (state.kbCategories.length === 0) {
      listKBCategories().then(cats => dispatch({ type: "SET_KB_CATEGORIES", payload: cats })).catch(() => {});
    }
  }, [dispatch, isAuthenticated, state.kbCategories.length]);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadKBDocuments(state.kbSelectedCategoryId ?? undefined).catch((err) => {
      setError(err instanceof Error ? err.message : "知识库文件加载失败");
    });
  }, [isAuthenticated, state.kbSelectedCategoryId, loadKBDocuments]);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadToKB(file, state.kbSelectedCategoryId ?? undefined);
      await loadKBDocuments(state.kbSelectedCategoryId ?? undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [state.kbSelectedCategoryId, loadKBDocuments]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteKBDocument(deleteTarget.id);
      dispatch({ type: "REMOVE_KB_DOCUMENT", payload: deleteTarget.id });
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }, [deleteTarget, dispatch]);

  const handleCategoryChange = useCallback(async (docId: number, categoryId: number | null) => {
    try {
      await setDocumentCategory(docId, categoryId);
      dispatch({
        type: "SET_KB_DOCUMENTS",
        payload: state.kbDocuments.map(d => d.id === docId ? { ...d, category_id: categoryId } : d),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "设置分类失败");
    }
  }, [state.kbDocuments, dispatch]);

  const handleCreateCategory = useCallback(async () => {
    if (!newCatName.trim()) return;
    try {
      const cat = await createKBCategory({ name: newCatName.trim(), parent_id: newCatParentId });
      dispatch({ type: "SET_KB_CATEGORIES", payload: [...state.kbCategories, cat] });
      setNewCatName("");
      setNewCatParentId(null);
      setShowNewCategory(false);
    } catch {
      setError("创建分类失败");
    }
  }, [newCatName, newCatParentId, state.kbCategories, dispatch]);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col flex-1 h-full overflow-y-auto bg-background px-8 py-6">
        <div className="mx-auto flex min-h-[60vh] w-full max-w-[760px] items-center justify-center">
          <div className="relative w-full overflow-hidden rounded-[2rem] border border-border/70 bg-card/86 p-8 text-center shadow-xl shadow-foreground/5 backdrop-blur-xl">
            <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/12 blur-3xl" />
            <div className="relative mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-primary/10 text-primary ring-1 ring-primary/15">
              <Database className="w-7 h-7" />
            </div>
            <div className="relative mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-primary/80">
              Knowledge Base
            </div>
            <h1 className="relative text-3xl font-black tracking-[-0.04em] text-foreground">登录后查看知识库</h1>
            <p className="relative mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              登录后可查看和管理你的个人知识库，上传文档并用于写作与对话检索。
            </p>
            <Button className="relative mt-6 rounded-full shadow-lg shadow-primary/20" onClick={() => setLoginDialogOpen(true)}>
              登录到 AI Blog
            </Button>
          </div>
        </div>
        <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
      </div>
    );
  }

  if (state.kbSelectedFile) {
    return (
      <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden bg-background px-2 py-2">
        <div className="mx-auto flex w-full max-w-[1040px] flex-1 min-h-0 flex-col">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-3xl border border-border/70 bg-card/86 p-2 shadow-xl shadow-foreground/5 backdrop-blur-xl">
            <Button
              variant="ghost"
              className="gap-1.5 rounded-full"
              onClick={() => dispatch({ type: "SET_KB_SELECTED_FILE", payload: null })}
            >
              <ArrowLeft className="w-4 h-4" />
              返回文件列表
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.xlsx"
              className="hidden"
              onChange={handleUpload}
            />
            <Button
              className="gap-1.5 rounded-full shadow-lg shadow-primary/20"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="w-3.5 h-3.5" />
              {uploading ? "上传中..." : "上传文件"}
            </Button>
          </div>
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-3xl border border-border/70 bg-card/90 p-2 shadow-xl shadow-foreground/5">
            <FilePreview filename={state.kbSelectedFile} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 h-full overflow-y-auto bg-background px-2 py-2">
      <div className="mx-auto w-full max-w-[1040px]">
        <div className="relative mb-2 overflow-hidden rounded-[2rem] border border-border/70 bg-card/86 p-6 shadow-xl shadow-foreground/5 backdrop-blur-xl">
          <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/12 blur-3xl" />
          <div className="absolute right-24 top-4 h-24 w-24 rounded-full bg-cyan-400/10 blur-2xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[13px] font-semibold text-primary">
                <Database className="w-3.5 h-3.5" />
                {selectedCategoryName || "全部文件"}
              </div>
              <h1 className="text-3xl font-black tracking-[-0.04em] text-foreground">知识库</h1>
              <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
                上传论文、文档和表格，把资料整理成可检索、可对话的知识资产。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="rounded-full bg-background/70"
                onClick={() => setShowNewCategory(!showNewCategory)}
              >
                <FolderPlus className="w-3.5 h-3.5" />
                {showNewCategory ? "收起" : "新建分类"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.xlsx"
                className="hidden"
                onChange={handleUpload}
              />
              <Button
                className="rounded-full shadow-lg shadow-primary/20"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="w-3.5 h-3.5" />
                {uploading ? "上传中..." : "上传文件"}
              </Button>
            </div>
          </div>

          {showNewCategory && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative mt-2 flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-background/72 p-3"
            >
              <Input
                className="h-10 flex-1 min-w-[180px] rounded-xl bg-card"
                placeholder="分类名称"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateCategory()}
              />
              <select
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors hover:border-primary focus:border-primary"
                value={newCatParentId ?? ""}
                onChange={(e) => setNewCatParentId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">无父分类</option>
                {flatCategories.map(c => (
                  <option key={c.id} value={c.id}>
                    {"  ".repeat(c._depth)}{c.name}
                  </option>
                ))}
              </select>
              <Button className="h-10 rounded-xl" onClick={handleCreateCategory}>
                创建
              </Button>
            </motion.div>
          )}
        </div>

        {error && (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-sm">
            <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-destructive hover:text-destructive/80"
              onClick={() => setError(null)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}

        {state.kbDocuments.length === 0 ? (
          <div className="flex min-h-[42vh] flex-col items-center justify-center rounded-[2rem] border border-dashed border-border bg-card/70 p-10 text-center shadow-sm">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-primary/10 text-primary ring-1 ring-primary/15">
              <Sparkles className="w-7 h-7" />
            </div>
            <h2 className="text-2xl font-bold tracking-[-0.03em] text-foreground">暂无文件</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              上传 PDF、Word 或 Excel 文档后，它们会出现在这里，并可按分类整理。
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button className="rounded-full" onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-4 h-4" />
                上传第一个文件
              </Button>
              <Button variant="outline" className="rounded-full" onClick={() => setShowNewCategory(true)}>
                <FolderPlus className="w-4 h-4" />
                新建分类
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
            {state.kbDocuments.map((doc) => (
              <motion.div
                key={doc.id}
                className="group relative overflow-hidden rounded-[1.35rem] border border-border/70 bg-card/88 p-4 shadow-sm transition-all duration-200 hover:border-primary/25 hover:shadow-xl hover:shadow-foreground/5"
                onClick={() => dispatch({ type: "SET_KB_SELECTED_FILE", payload: doc.file_path })}
                whileHover={{ y: -4 }}
              >
                <div className="absolute inset-x-0 top-0 h-1 bg-primary/70 opacity-0 transition-opacity group-hover:opacity-100" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-3 top-3 h-7 w-7 rounded-full opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget({ id: doc.id, name: doc.original_name });
                  }}
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>

                <div className="mb-4 flex items-start gap-3 pr-8">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-secondary/80 ring-1 ring-border/70">
                    {getDocumentIcon(doc.original_name)}
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="line-clamp-2 break-all text-[15px] font-semibold leading-snug text-foreground">
                      {doc.original_name}
                    </div>
                    <div className="mt-1 text-[13px] text-muted-foreground">
                      {doc.chunk_count} 个片段 · {formatDate(doc.created_at)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-3" onClick={(e) => e.stopPropagation()}>
                  {doc.category_id && categoryMap.has(doc.category_id) ? (
                    <Badge
                      variant="secondary"
                      className="cursor-pointer rounded-full bg-primary/10 text-primary hover:bg-primary/15"
                      onClick={() => handleCategoryChange(doc.id, null)}
                    >
                      <FolderOpen className="w-3 h-3" />
                      {categoryMap.get(doc.category_id)}
                      <span className="ml-1 text-primary/60">×</span>
                    </Badge>
                  ) : (
                    <select
                      className="max-w-[150px] cursor-pointer rounded-full border border-border bg-secondary/70 px-3 py-1 text-[13px] text-muted-foreground outline-none transition-colors hover:border-primary focus:border-primary"
                      value=""
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) handleCategoryChange(doc.id, Number(v));
                      }}
                    >
                      <option value="">设置分类</option>
                      {flatCategories.map(c => (
                        <option key={c.id} value={c.id}>
                          {"  ".repeat(c._depth)}{c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除文件</DialogTitle>
            <DialogDescription>
              确定要删除「{deleteTarget?.name}」吗？这个操作会从知识库中移除该文件。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleConfirmDelete}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
