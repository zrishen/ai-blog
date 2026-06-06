import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useChat } from "../stores/chatStore";
import type { KBCategory } from "../stores/chatStore";
import { useAuth } from "../stores/authStore";
import {
  listKBCategories,
  listKBDocuments,
  createKBCategory,
  deleteKBCategory,
  updateKBCategory,
  uploadToKB,
} from "../api/client";
import {
  listResearchTopics,
  createResearchTopic,
  getResearchTopic,
  deleteResearchTopic,
} from "../api/client";
import { motion } from "motion/react";
import { extractHeadings, type TocItem } from "../features/blog/blogToc";
import {
  BookOpen,
  FolderOpen,
  Folder,
  FileText,
  FileSpreadsheet,
  FileImage,
  File,
  ChevronRight,
  FolderPlus,
  Trash2,
  Upload,
  Pencil,
  Tags,
  Plus,
  RefreshCw,
  Loader2,
  GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getBlogTagStyle, splitBlogTags } from "../features/blog/blogTags";

interface EditingState {
  type: "rename" | "newSub";
  categoryId: number;
  value: string;
}

function isDescOf(targetId: number, ancestorId: number, tree: KBCategory[]): boolean {
  for (const cat of tree) {
    if (cat.id === ancestorId) {
      return containsId(targetId, cat.children ?? []);
    }
    if (isDescOf(targetId, ancestorId, cat.children ?? [])) return true;
  }
  return false;
}

function containsId(id: number, tree: KBCategory[]): boolean {
  for (const cat of tree) {
    if (cat.id === id) return true;
    if (containsId(id, cat.children ?? [])) return true;
  }
  return false;
}

function findCategoryById(id: number, tree: KBCategory[]): KBCategory | null {
  for (const cat of tree) {
    if (cat.id === id) return cat;
    const child = findCategoryById(id, cat.children ?? []);
    if (child) return child;
  }
  return null;
}

function getParentSlug(headings: TocItem[], slug: string): string {
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].slug === slug) {
      for (let j = i - 1; j >= 0; j--) {
        if (headings[j].level === 2) return headings[j].slug;
      }
      break;
    }
  }
  return "";
}

function CategoryTree({
  categories,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
  onRequestDelete,
  onRequestNewSub,
  onRequestUpload,
  onRequestRename,
  editingState,
  onEditingValueChange,
  onEditingSubmit,
  onEditingCancel,
  dragCategoryId,
  dropTargetId,
  onDragStart,
  onDragEnd,
  onDropOnCategory,
  onDropTargetChange,
  depth = 0,
}: {
  categories: KBCategory[];
  selectedId: number | null;
  expandedIds: Set<number>;
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
  onRequestDelete: (id: number, name: string) => void;
  onRequestNewSub: (parentId: number) => void;
  onRequestUpload: (id: number, name: string) => void;
  onRequestRename: (id: number, currentName: string) => void;
  editingState: EditingState | null;
  onEditingValueChange: (value: string) => void;
  onEditingSubmit: () => void;
  onEditingCancel: () => void;
  dragCategoryId: number | null;
  dropTargetId: number | null;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
  onDropOnCategory: (sourceId: number, targetId: number) => Promise<void>;
  onDropTargetChange: (id: number | null) => void;
  depth?: number;
}) {
  return categories.map((cat) => {
    const hasChildren = Boolean(cat.children?.length);
    const isExpanded = expandedIds.has(cat.id);
    const isRenaming =
      editingState?.type === "rename" && editingState.categoryId === cat.id;
    const showNewSubInput =
      editingState?.type === "newSub" && editingState.categoryId === cat.id;
    const isDropTarget = dropTargetId === cat.id;
    const isDragging = dragCategoryId === cat.id;

    return (
      <Fragment key={cat.id}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            {isRenaming ? (
              <div
                className="flex items-center"
                style={{ paddingLeft: 12 + depth * 16 }}
              >
                {hasChildren ? (
                  <ChevronRight
                    className={`w-3.5 h-3.5 flex-shrink-0 text-muted-foreground transition-transform mr-2 ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  />
                ) : (
                  <Folder className="w-4 h-4 flex-shrink-0 mr-2" />
                )}
                <Input
                  value={editingState.value}
                  onChange={(e) => onEditingValueChange(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") onEditingSubmit();
                    if (e.key === "Escape") onEditingCancel();
                  }}
                  onBlur={() => {
                    if (editingState.value.trim()) {
                      onEditingSubmit();
                    } else {
                      onEditingCancel();
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="h-7 text-[13px] px-2 py-1"
                  autoFocus
                />
              </div>
            ) : (
              <Button
                variant={selectedId === cat.id ? "secondary" : "ghost"}
                className={`justify-start text-[13px] px-3 py-2.5 rounded-xl h-auto font-medium gap-2 transition-all duration-150 hover:translate-x-0.5 hover:bg-primary/8 ${
                  selectedId === cat.id ? "bg-primary/10 text-primary shadow-sm" : ""
                } ${isDragging ? "opacity-40 scale-[0.98]" : ""} ${isDropTarget ? "ring-2 ring-primary/60 bg-primary/12 shadow-md shadow-primary/10" : ""}`}
                style={{ paddingLeft: 12 + depth * 16 }}
                onClick={() => {
                  onSelect(cat.id);
                  if (hasChildren) onToggle(cat.id);
                }}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.setData("text/plain", String(cat.id));
                  e.dataTransfer.effectAllowed = "move";
                  onDragStart(cat.id);
                }}
                onDragEnd={(e) => {
                  e.stopPropagation();
                  onDragEnd();
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (dragCategoryId && dragCategoryId !== cat.id) {
                    onDropTargetChange(cat.id);
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  if (dragCategoryId && dragCategoryId !== cat.id) {
                    onDropTargetChange(cat.id);
                  }
                }}
                onDragLeave={(e) => {
                  e.stopPropagation();
                  const nextTarget = e.relatedTarget as Node | null;
                  if (!nextTarget || !e.currentTarget.contains(nextTarget)) {
                    onDropTargetChange(null);
                  }
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const sourceId =
                    Number(e.dataTransfer.getData("text/plain")) || dragCategoryId;
                  if (sourceId && sourceId !== cat.id) {
                    await onDropOnCategory(sourceId, cat.id);
                  }
                  onDropTargetChange(null);
                }}
              >
                {hasChildren ? (
                  <ChevronRight
                    className={`w-3.5 h-3.5 flex-shrink-0 text-muted-foreground transition-transform ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  />
                ) : (
                  <Folder className="w-4 h-4 flex-shrink-0" />
                )}
                {cat.name}
              </Button>
            )}
          </ContextMenuTrigger>
          <ContextMenuContent className="w-44">
            <ContextMenuItem onClick={() => onRequestNewSub(cat.id)}>
              <FolderPlus className="w-4 h-4" />
              新建子分类
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onRequestUpload(cat.id, cat.name)}>
              <Upload className="w-4 h-4" />
              上传文件
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onRequestRename(cat.id, cat.name)}>
              <Pencil className="w-4 h-4" />
              重命名
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() => onRequestDelete(cat.id, cat.name)}
            >
              <Trash2 className="w-4 h-4" />
              删除分类
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {hasChildren && isExpanded ? (
          <>
            {showNewSubInput && (
              <div
                className="flex items-center"
                style={{ paddingLeft: 12 + (depth + 1) * 16 }}
              >
                <Folder className="w-4 h-4 flex-shrink-0 mr-2" />
                <Input
                  value={editingState!.value}
                  onChange={(e) => onEditingValueChange(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") onEditingSubmit();
                    if (e.key === "Escape") onEditingCancel();
                  }}
                  onBlur={() => {
                    if (editingState!.value.trim()) {
                      onEditingSubmit();
                    } else {
                      onEditingCancel();
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="h-7 text-[13px] px-2 py-1"
                  autoFocus
                  placeholder="输入分类名称"
                />
              </div>
            )}
            <CategoryTree
              categories={cat.children ?? []}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
              onRequestDelete={onRequestDelete}
              onRequestNewSub={onRequestNewSub}
              onRequestUpload={onRequestUpload}
              onRequestRename={onRequestRename}
              editingState={editingState}
              onEditingValueChange={onEditingValueChange}
              onEditingSubmit={onEditingSubmit}
              onEditingCancel={onEditingCancel}
              dragCategoryId={dragCategoryId}
              dropTargetId={dropTargetId}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropOnCategory={onDropOnCategory}
              onDropTargetChange={onDropTargetChange}
              depth={depth + 1}
            />
          </>
        ) : showNewSubInput ? (
          <div
            className="flex items-center"
            style={{ paddingLeft: 12 + (depth + 1) * 16 }}
          >
            <Folder className="w-4 h-4 flex-shrink-0 mr-2" />
            <Input
              value={editingState!.value}
              onChange={(e) => onEditingValueChange(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") onEditingSubmit();
                if (e.key === "Escape") onEditingCancel();
              }}
              onBlur={() => {
                if (editingState!.value.trim()) {
                  onEditingSubmit();
                } else {
                  onEditingCancel();
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-7 text-[13px] px-2 py-1"
              autoFocus
              placeholder="输入分类名称"
            />
          </div>
        ) : null}
      </Fragment>
    );
  });
}

export function LeftSidebar() {
  const { state, dispatch } = useChat();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<
    Set<number>
  >(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadCategoryRef = useRef<number | null>(null);

  // Dialog states
  const [deleteTarget, setDeleteTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [uploadTarget, setUploadTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [editingState, setEditingState] = useState<EditingState | null>(null);

  // Drag-and-drop states
  const [dragCategoryId, setDragCategoryId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [kbActionError, setKbActionError] = useState<string | null>(null);

  // Research state
  const [newResearchTitle, setNewResearchTitle] = useState("");
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchDeleteTarget, setResearchDeleteTarget] = useState<{
    id: number;
    title: string;
  } | null>(null);
  const [researchDeletingId, setResearchDeletingId] = useState<number | null>(null);
  const [researchActionError, setResearchActionError] = useState<string | null>(null);

  const loadResearchTopics = useCallback(async () => {
    if (!isAuthenticated) return;
    setResearchLoading(true);
    setResearchActionError(null);
    try {
      const topics = await listResearchTopics();
      dispatch({ type: "SET_RESEARCH_TOPICS", payload: topics });
    } catch {
      // silent
    } finally {
      setResearchLoading(false);
    }
  }, [dispatch, isAuthenticated]);

  useEffect(() => {
    if (state.currentPage === "research" && isAuthenticated) {
      loadResearchTopics();
    }
  }, [isAuthenticated, state.currentPage, loadResearchTopics]);

  const handleCreateResearchTopic = useCallback(async () => {
    const title = newResearchTitle.trim();
    if (!title) return;
    setResearchActionError(null);
    try {
      const topic = await createResearchTopic({ title });
      dispatch({ type: "SET_RESEARCH_TOPICS", payload: [topic, ...state.researchTopics] });
      setNewResearchTitle("");
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC_ID", payload: topic.id });
      dispatch({ type: "SET_RESEARCH_SELECTED_CLAIM_ID", payload: null });
      dispatch({ type: "SET_RESEARCH_SELECTED_CONFLICT_ID", payload: null });
      dispatch({ type: "SET_RESEARCH_SELECTED_PROPOSAL_ID", payload: null });
      navigate(`/research/${topic.id}`);
      const detail = await getResearchTopic(topic.id);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
    } catch {
      // silent
    }
  }, [dispatch, navigate, newResearchTitle, state.researchTopics]);

  const selectResearchTopic = useCallback(async (id: number) => {
    dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC_ID", payload: id });
    dispatch({ type: "SET_RESEARCH_SELECTED_CLAIM_ID", payload: null });
    dispatch({ type: "SET_RESEARCH_SELECTED_CONFLICT_ID", payload: null });
    navigate(`/research/${id}`);
    try {
      const detail = await getResearchTopic(id);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
    } catch {
      // silent
    }
  }, [dispatch, navigate]);

  const handleConfirmDeleteResearchTopic = useCallback(async () => {
    if (!researchDeleteTarget || researchDeletingId !== null) return;
    const { id } = researchDeleteTarget;
    setResearchDeletingId(id);
    setResearchActionError(null);
    try {
      await deleteResearchTopic(id);
      dispatch({
        type: "SET_RESEARCH_TOPICS",
        payload: state.researchTopics.filter((topic) => topic.id !== id),
      });
      if (state.researchCurrentTopicId === id) {
        dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC_ID", payload: null });
        dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: null });
        dispatch({ type: "SET_RESEARCH_SELECTED_CLAIM_ID", payload: null });
        dispatch({ type: "SET_RESEARCH_SELECTED_CONFLICT_ID", payload: null });
        navigate("/research");
      }
      await loadResearchTopics();
    } catch (err) {
      console.error("Failed to delete research topic:", err);
      setResearchActionError(err instanceof Error ? err.message : "删除研究主题失败");
    } finally {
      setResearchDeletingId(null);
      setResearchDeleteTarget(null);
    }
  }, [dispatch, loadResearchTopics, navigate, researchDeleteTarget, researchDeletingId, state.researchCurrentTopicId, state.researchTopics]);

  function researchStatusLabel(status: string) {
    const labels: Record<string, string> = {
      draft: "草稿",
      researching: "研究中",
      reviewing: "待审核",
      ready: "已确认",
      stale: "可能过期",
      archived: "已归档",
    };
    return labels[status] ?? status;
  }

  function getFileIcon(fileName: string) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "pdf":
        return <FileText className="w-4 h-4 flex-shrink-0 text-red-500" />;
      case "docx":
      case "doc":
        return <FileText className="w-4 h-4 flex-shrink-0 text-blue-500" />;
      case "xlsx":
      case "xls":
        return (
          <FileSpreadsheet className="w-4 h-4 flex-shrink-0 text-green-500" />
        );
      case "png":
      case "jpg":
      case "jpeg":
      case "gif":
        return <FileImage className="w-4 h-4 flex-shrink-0 text-purple-500" />;
      default:
        return (
          <File className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
        );
    }
  }

  const loadKBCats = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const cats = await listKBCategories();
      dispatch({ type: "SET_KB_CATEGORIES", payload: cats });
    } catch (e) {
      console.error("Failed to load KB categories:", e);
    }
  }, [dispatch, isAuthenticated]);

  useEffect(() => {
    if (state.currentPage === "knowledge" && isAuthenticated) {
      loadKBCats();
    }
  }, [isAuthenticated, state.currentPage, loadKBCats]);

  const loadKBDocs = useCallback(
    async (categoryId: number | null) => {
      if (!isAuthenticated) return;
      try {
        const data = await listKBDocuments(categoryId ?? undefined);
        dispatch({ type: "SET_KB_DOCUMENTS", payload: data.documents });
      } catch (e) {
        console.error("Failed to load KB documents:", e);
        setKbActionError(e instanceof Error ? e.message : "知识库文件加载失败");
      }
    },
    [dispatch, isAuthenticated]
  );

  useEffect(() => {
    if (state.currentPage === "knowledge" && isAuthenticated) {
      loadKBDocs(state.kbSelectedCategoryId);
    }
  }, [isAuthenticated, state.currentPage, state.kbSelectedCategoryId, loadKBDocs]);

  const handleCategorySelect = (id: number | null) => {
    dispatch({ type: "SET_KB_SELECTED_CATEGORY_ID", payload: id });
    dispatch({ type: "SET_KB_SELECTED_FILE", payload: null });
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
    dispatch({ type: "SET_KB_SELECTED_FILE", payload: fileName });
  };

  // Delete dialog handlers
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteKBCategory(id);
      if (state.kbSelectedCategoryId === id) {
        dispatch({ type: "SET_KB_SELECTED_CATEGORY_ID", payload: null });
      }
      await loadKBCats();
      await loadKBDocs(
        state.kbSelectedCategoryId === id ? null : state.kbSelectedCategoryId
      );
    } catch (e) {
      console.error("Failed to delete category:", e);
    }
  };

  // Upload dialog handlers
  const handleUploadFilePick = () => {
    if (!uploadTarget) return;
    const { id } = uploadTarget;
    pendingUploadCategoryRef.current = id;
    setUploadTarget(null);
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 100);
  };

  // Inline editing handlers
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
        await updateKBCategory(categoryId, { name: trimmed });
      } else {
        await createKBCategory({ name: trimmed, parent_id: categoryId });
      }
      await loadKBCats();
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

  // Drag-and-drop: move category into another
  const handleDropOnCategory = useCallback(
    async (sourceId: number, targetId: number) => {
      setDropTargetId(null);
      if (sourceId === targetId) return;
      if (isDescOf(targetId, sourceId, state.kbCategories)) return;
      const source = findCategoryById(sourceId, state.kbCategories);
      if (!source) return;
      try {
        await updateKBCategory(sourceId, { name: source.name, parent_id: targetId });
        setExpandedCategoryIds((prev) => {
          const next = new Set(prev);
          next.add(targetId);
          return next;
        });
        await loadKBCats();
      } catch (e) {
        console.error("Failed to move category:", e);
      } finally {
        setDragCategoryId(null);
      }
    },
    [state.kbCategories, loadKBCats]
  );

  // Drop on "全部分类" → move to root
  const handleDropOnRoot = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const sourceId = Number(e.dataTransfer.getData("text/plain"));
      if (!sourceId) return;
      const source = findCategoryById(sourceId, state.kbCategories);
      if (!source) return;
      try {
        await updateKBCategory(sourceId, { name: source.name, parent_id: null });
        await loadKBCats();
      } catch (err) {
        console.error("Failed to move category to root:", err);
      }
    },
    [loadKBCats, state.kbCategories]
  );

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const categoryId = pendingUploadCategoryRef.current;
    try {
      setKbActionError(null);
      await uploadToKB(file, categoryId ?? undefined);
      if (categoryId !== state.kbSelectedCategoryId) {
        dispatch({ type: "SET_KB_SELECTED_CATEGORY_ID", payload: categoryId });
      }
      await loadKBDocs(categoryId);
    } catch (err) {
      console.error("Failed to upload file:", err);
      setKbActionError(err instanceof Error ? err.message : "知识库上传失败");
    } finally {
      pendingUploadCategoryRef.current = null;
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const currentBlogPost = state.blogPosts.find((p) => p.id === state.blogCurrentPostId);
  const headings = useMemo(() => extractHeadings(currentBlogPost?.content || ""), [currentBlogPost?.content]);
  const [expandedHeadingSlugs, setExpandedHeadingSlugs] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedHeadingSlugs(new Set(headings.filter((h) => h.level === 2).map((h) => h.slug)));
  }, [headings]);

  const toggleHeading = useCallback((slug: string) => {
    setExpandedHeadingSlugs((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  }, []);

  const scrollToHeading = useCallback((slug: string) => {
    const el = document.getElementById(slug);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Landing page intro post tags
  const location = useLocation();
  const introPost = state.blogPosts?.find((p) => p.slug === "ai-blog-intro");
  const introTags = useMemo(() => splitBlogTags(introPost?.tags), [introPost?.tags]);

  // Edit page live TOC hooks (must be unconditional — Rules of Hooks)
  const [liveHeadings, setLiveHeadings] = useState<TocItem[]>([]);
  const [editExpandedSlugs, setEditExpandedSlugs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (state.currentPage !== "blog" || state.blogCurrentView !== "edit") return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;

    const extract = () => {
      if (cancelled) return;
      const el = document.querySelector(".blog-editor-body .vditor-wysiwyg") as Element | null;
      if (!el || el.querySelectorAll("h2, h3, h4").length === 0) return false;
      const hs: TocItem[] = [];
      el.querySelectorAll("h2, h3, h4").forEach((node) => {
        const level = parseInt(node.tagName[1]);
        const text = node.textContent || "";
        const slug = text.toLowerCase().replace(/[^\w一-鿿]+/g, "-").replace(/^-|-$/g, "");
        hs.push({ level, text, slug });
      });
      if (!cancelled) {
        setLiveHeadings(hs);
        setEditExpandedSlugs(new Set(hs.filter((h) => h.level === 2).map((h) => h.slug)));
      }
      return true;
    };

    const tryExtract = () => {
      if (extract()) {
        // Headings found — set up MutationObserver for live updates
        const el = document.querySelector(".blog-editor-body .vditor-wysiwyg") as Element | null;
        if (el && !cancelled) {
          observer = new MutationObserver(() => extract());
          observer.observe(el, { childList: true, subtree: true, characterData: true });
        }
      } else {
        // Retry until Vditor renders content
        retryTimer = setTimeout(tryExtract, 200);
      }
    };

    tryExtract();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      observer?.disconnect();
      setLiveHeadings([]);
    };
  }, [state.blogCurrentView]);

  // Blog view — show article TOC with collapse
  if (state.currentPage === "blog" && state.blogCurrentView === "view") {
    return (
      <aside className="w-full h-full bg-card/82 backdrop-blur-xl border-r border-border/80 flex flex-col overflow-y-auto select-none shadow-[12px_0_35px_hsl(var(--foreground)/0.03)]">
        <div className="p-4 flex flex-col gap-3">
          <div className="text-xs text-muted-foreground leading-relaxed pt-2 pb-2 border-t border-border">
            当前文章
            <strong className="block text-sm text-foreground mt-1 truncate">
              {currentBlogPost?.title || "加载中..."}
            </strong>
          </div>
          {headings.length > 0 && (
            <nav className="flex flex-col gap-0 mt-1">
              <span className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground/70 font-semibold px-1">目录</span>
              {headings.map((h) => {
                const isH2 = h.level === 2;
                return (
                  <div key={h.slug} className={`flex items-center gap-0 px-1.5 py-1 rounded-lg ${isH2 ? "text-foreground font-medium" : h.level === 3 ? "text-muted-foreground" : "text-muted-foreground/70"} ${!isH2 && !expandedHeadingSlugs.has(getParentSlug(headings, h.slug)) ? "hidden" : ""}`}>
                    {isH2 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleHeading(h.slug); }}
                        className="shrink-0 p-0.5 rounded hover:bg-primary/10 transition-colors"
                        title={expandedHeadingSlugs.has(h.slug) ? "收起" : "展开"}
                      >
                        <ChevronRight className={`w-3 h-3 transition-transform duration-150 ${expandedHeadingSlugs.has(h.slug) ? "rotate-90" : ""}`} />
                      </button>
                    )}
                    <button
                      onClick={() => scrollToHeading(h.slug)}
                      className={`flex-1 text-left text-[13px] leading-snug truncate transition-colors hover:text-primary hover:bg-primary/8 rounded-md ${isH2 ? "" : h.level === 3 ? "pl-3" : "pl-5"}`}
                    >
                      {h.text}
                    </button>
                  </div>
                );
              })}
            </nav>
          )}
        </div>
      </aside>
    );
  }

  // Blog edit — show live TOC from Vditor with collapse
  if (state.currentPage === "blog" && state.blogCurrentView === "edit") {
    const scrollToEl = (el: Element) => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    return (
      <aside className="w-full h-full bg-card/82 backdrop-blur-xl border-r border-border/80 flex flex-col overflow-y-auto select-none shadow-[12px_0_35px_hsl(var(--foreground)/0.03)]">
        <div className="p-4 flex flex-col gap-3">
          <div className="text-xs text-muted-foreground leading-relaxed pt-2 pb-2 border-t border-border">
            编辑中
            <strong className="block text-sm text-foreground mt-1 truncate">
              {currentBlogPost?.title || "新文章"}
            </strong>
          </div>
          {liveHeadings.length > 0 && (
            <nav className="flex flex-col gap-0 mt-1">
              <span className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground/70 font-semibold px-1">目录</span>
              {liveHeadings.map((h) => {
                const isH2 = h.level === 2;
                return (
                  <div key={`${h.slug}-${h.text}`} className={`flex items-center gap-0 px-1.5 py-1 rounded-lg ${isH2 ? "text-foreground font-medium" : h.level === 3 ? "text-muted-foreground" : "text-muted-foreground/70"} ${!isH2 && !editExpandedSlugs.has(getParentSlug(liveHeadings, h.slug)) ? "hidden" : ""}`}>
                    {isH2 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditExpandedSlugs((prev) => { const n = new Set(prev); n.has(h.slug) ? n.delete(h.slug) : n.add(h.slug); return n; }); }}
                        className="shrink-0 p-0.5 rounded hover:bg-primary/10 transition-colors"
                        title={editExpandedSlugs.has(h.slug) ? "收起" : "展开"}
                      >
                        <ChevronRight className={`w-3 h-3 transition-transform duration-150 ${editExpandedSlugs.has(h.slug) ? "rotate-90" : ""}`} />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const editor = document.querySelector(".blog-editor-body .vditor-wysiwyg");
                        if (!editor) return;
                        const tag = `h${h.level}`;
                        const target = Array.from(editor.querySelectorAll(tag)).find(
                          (el) => el.textContent?.trim() === h.text
                        );
                        if (target) scrollToEl(target);
                      }}
                      className={`flex-1 text-left text-[13px] leading-snug truncate transition-colors hover:text-primary hover:bg-primary/8 rounded-md ${isH2 ? "" : h.level === 3 ? "pl-3" : "pl-5"}`}
                    >
                      {h.text}
                    </button>
                  </div>
                );
              })}
            </nav>
          )}
          {liveHeadings.length === 0 && (
            <span className="text-xs text-muted-foreground/50 px-1 pt-2">输入标题后显示目录</span>
          )}
        </div>
      </aside>
    );
  }

  // Knowledge base — category tree + file list
  if (state.currentPage === "knowledge") {
    if (!isAuthenticated) {
      return (
        <aside className="w-full h-full bg-card/82 backdrop-blur-xl border-r border-border/80 flex flex-col overflow-y-auto select-none shadow-[12px_0_35px_hsl(var(--foreground)/0.03)]">
          <div className="p-4 flex flex-col gap-3">
            <div className="rounded-2xl border border-border/70 bg-primary/8 p-3 shadow-sm">
              <div className="text-[11px] uppercase tracking-[0.18em] text-primary/80 font-bold">
                Library
              </div>
              <div className="mt-1 text-sm font-semibold text-foreground">知识分类</div>
              <div className="mt-1 text-[11px] text-muted-foreground">登录后显示个人知识库</div>
            </div>
          </div>
        </aside>
      );
    }

    return (
      <aside className="w-full h-full bg-card/82 backdrop-blur-xl border-r border-border/80 flex flex-col overflow-y-auto select-none shadow-[12px_0_35px_hsl(var(--foreground)/0.03)]">
        <div className="p-4 flex flex-col gap-3">
          <div className="rounded-2xl border border-border/70 bg-primary/8 p-3 shadow-sm">
            <div className="text-[11px] uppercase tracking-[0.18em] text-primary/80 font-bold">
              Library
            </div>
            <div className="mt-1 text-sm font-semibold text-foreground">知识分类</div>
            <div className="mt-1 text-[11px] text-muted-foreground">右键管理，拖拽整理层级</div>
          </div>
          {kbActionError && (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
              {kbActionError}
            </div>
          )}
          <Button
            variant={
              state.kbSelectedCategoryId === null ? "secondary" : "ghost"
            }
            className={`justify-start text-[13px] px-3 py-2.5 rounded-xl h-auto font-semibold gap-2 transition-all hover:translate-x-0.5 ${
              state.kbSelectedCategoryId === null ? "bg-primary/10 text-primary shadow-sm" : ""
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
          {state.kbCategories.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/50 px-3 py-4 text-center text-xs text-muted-foreground">
              暂无分类，右键或在主界面新建
            </div>
          )}
          <CategoryTree
            categories={state.kbCategories}
            selectedId={state.kbSelectedCategoryId}
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
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
              文件
            </div>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
              {state.kbDocuments.length}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {state.kbDocuments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/50 px-3 py-4 text-center text-xs text-muted-foreground">暂无文件</div>
            ) : (
              state.kbDocuments.map((doc) => (
                <Button
                  key={doc.id}
                  variant={
                    state.kbSelectedFile === doc.file_path
                      ? "secondary"
                      : "ghost"
                  }
                  className="justify-start text-xs px-3 py-2 rounded-xl h-auto font-medium gap-2 truncate transition-all hover:translate-x-0.5 hover:bg-primary/8"
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

        {/* 删除确认 Dialog */}
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

        {/* 上传文件 Dialog */}
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

  // Research — topic list
  if (state.currentPage === "research") {
    if (!isAuthenticated) {
      return (
        <aside className="w-full h-full bg-card/82 backdrop-blur-xl border-r border-border/80 flex flex-col overflow-y-auto select-none shadow-[12px_0_35px_hsl(var(--foreground)/0.03)]">
          <div className="p-4 flex flex-col gap-3">
            <div className="rounded-2xl border border-border/70 bg-primary/8 p-3 shadow-sm">
              <div className="text-[11px] uppercase tracking-[0.18em] text-primary/80 font-bold">Research</div>
              <div className="mt-1 text-sm font-semibold text-foreground">研究主题</div>
              <div className="mt-1 text-[11px] text-muted-foreground">登录后管理研究主题</div>
            </div>
          </div>
        </aside>
      );
    }

    return (
      <aside className="w-full h-full bg-card/82 backdrop-blur-xl border-r border-border/80 flex flex-col overflow-y-auto select-none shadow-[12px_0_35px_hsl(var(--foreground)/0.03)]">
        <div className="p-4 flex flex-col gap-3">
          <div className="rounded-2xl border border-border/70 bg-primary/8 p-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-primary/80 font-bold">Research</div>
                <div className="mt-1 text-sm font-semibold text-foreground">研究主题</div>
              </div>
              <button
                className="rounded-full p-1.5 hover:bg-primary/15 transition-colors"
                onClick={loadResearchTopics}
                disabled={researchLoading}
                title="刷新"
              >
                {researchLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">收集来源、审核事实、处理冲突</div>
          </div>

          <div className="flex gap-2">
            <Input
              value={newResearchTitle}
              onChange={(e) => setNewResearchTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateResearchTopic(); }}
              placeholder="新建研究主题"
              className="rounded-full bg-background/70 text-sm"
            />
            <Button size="icon" className="shrink-0 rounded-full" onClick={handleCreateResearchTopic} disabled={!newResearchTitle.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {researchActionError && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
              {researchActionError}
            </div>
          )}

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {state.researchTopics.length === 0 && !researchLoading ? (
              <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/50 px-3 py-4 text-center text-xs text-muted-foreground">
                暂无研究主题，先创建一个主题开始收集来源和事实。
              </div>
            ) : state.researchTopics.map((topic) => {
              const isActive = topic.id === state.researchCurrentTopicId;
              const statusColor = topic.status === "draft" ? "bg-muted-foreground/20"
                : topic.status === "researching" ? "bg-blue-500"
                : topic.status === "ready" ? "bg-emerald-500"
                : topic.status === "stale" ? "bg-amber-500"
                : "bg-primary";
              return (
                <ContextMenu key={topic.id}>
                  <ContextMenuTrigger asChild>
                    <motion.button
                      whileHover={{ x: researchDeletingId === topic.id ? 0 : 3 }}
                      transition={{ duration: 0.15 }}
                      className={`group w-full rounded-[1.25rem] border p-3 text-left transition-colors ${
                        isActive
                          ? "border-primary/30 bg-primary/8 shadow-sm shadow-primary/8"
                          : "border-border/60 bg-card/70 hover:border-primary/18 hover:bg-accent/50"
                      } ${researchDeletingId === topic.id ? "opacity-60" : ""}`}
                      onClick={() => selectResearchTopic(topic.id)}
                      disabled={researchDeletingId === topic.id}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl ${isActive ? "bg-primary/12" : "bg-secondary/80"} transition-colors`}>
                          <GitBranch className={`h-3.5 w-3.5 ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"} transition-colors`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-1 text-[13px] font-semibold leading-snug text-foreground">{topic.title}</div>
                          {topic.description && (
                            <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{topic.description}</div>
                          )}
                        </div>
                        <span className={`h-2 w-2 shrink-0 rounded-full ${statusColor}`} title={researchStatusLabel(topic.status)} />
                      </div>
                    </motion.button>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-44">
                    <ContextMenuItem
                      variant="destructive"
                      disabled={researchDeletingId === topic.id}
                      onClick={() => {
                        setResearchActionError(null);
                        setResearchDeleteTarget({ id: topic.id, title: topic.title });
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                      删除主题
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        </div>

        <Dialog
          open={researchDeleteTarget !== null}
          onOpenChange={(open) => {
            if (!open && researchDeletingId === null) setResearchDeleteTarget(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>确认永久删除</DialogTitle>
              <DialogDescription>
                确定要永久删除研究主题「{researchDeleteTarget?.title}」吗？该操作会删除关联来源、证据、事实、实体、关系、提案、运行记录以及博客引用链接，且不可恢复。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={researchDeletingId !== null}>取消</Button>
              </DialogClose>
              <Button
                variant="destructive"
                onClick={handleConfirmDeleteResearchTopic}
                disabled={researchDeleteTarget === null || researchDeletingId !== null}
              >
                {researchDeletingId !== null && <Loader2 className="h-4 w-4 animate-spin" />}
                永久删除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </aside>
    );
  }

  // Default: blog list — identity, stats, tags
  const publishedCount = state.blogPosts.filter((p) => p.status === "published").length;
  const draftCount = state.blogPosts.length - publishedCount;
  const tagCounts = new Map<string, number>();
  state.blogPosts.forEach((post) => {
    splitBlogTags(post.tags).forEach((tag) => {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    });
  });
  if (location.pathname === "/") {
    introTags.forEach((tag) => {
      if (!tagCounts.has(tag)) tagCounts.set(tag, 1);
    });
  }
  const tagEntries = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));

  return (
    <aside className="w-full h-full bg-card/82 backdrop-blur-xl border-r border-border/80 flex flex-col overflow-y-auto select-none shadow-[12px_0_35px_hsl(var(--foreground)/0.03)]">
      <div className="p-4 flex flex-col gap-4">
        <section className="rounded-[1.6rem] border border-border/70 bg-card/92 p-4 text-center shadow-sm">
          <motion.div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-primary text-primary-foreground shadow-xl shadow-primary/20"
            whileHover={{ scale: 1.05 }}
            transition={{ duration: 0.2 }}
          >
            <BookOpen className="w-6 h-6" />
          </motion.div>
          <div className="mt-3 text-[11px] font-bold uppercase tracking-[0.18em] text-primary/80">
            Blog Studio
          </div>
          <div className="mt-1 text-base font-black tracking-[-0.035em] text-foreground">写作工作台</div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            文章、草稿、标签与封面素材统一在这里沉淀。
          </p>
        </section>

        <section className="rounded-[1.4rem] border border-border/70 bg-secondary/50 p-3 shadow-sm">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Overview
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl border border-border/60 bg-background/62 px-2 py-3">
              <div className="text-xl font-black tracking-[-0.04em] text-foreground">{state.blogPosts.length}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">文章</div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/62 px-2 py-3">
              <div className="text-xl font-black tracking-[-0.04em] text-primary">{publishedCount}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">已发布</div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/62 px-2 py-3">
              <div className="text-xl font-black tracking-[-0.04em] text-amber-600 dark:text-amber-300">{draftCount}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">草稿</div>
            </div>
          </div>
        </section>

        <section className="rounded-[1.4rem] border border-border/70 bg-card/80 p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              <Tags className="h-3.5 w-3.5 text-primary" />
              Tags
            </div>
            <div className="flex items-center gap-2">
              {state.blogSelectedTag && (
                <button
                  className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/25 transition-colors"
                  onClick={() => dispatch({ type: "SET_BLOG_SELECTED_TAG", payload: null })}
                >
                  清除筛选
                </button>
              )}
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                {tagEntries.length}
              </span>
            </div>
          </div>
          {tagEntries.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/45 px-3 py-5 text-center text-xs text-muted-foreground">
              暂无标签
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tagEntries.map(([tag, count]) => {
                const isSelected = state.blogSelectedTag === tag;
                return (
                  <button
                    key={tag}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold cursor-pointer transition-all ${isSelected ? "ring-2 ring-primary scale-105" : "hover:opacity-80"}`}
                    style={getBlogTagStyle(tag)}
                    onClick={() => dispatch({ type: "SET_BLOG_SELECTED_TAG", payload: isSelected ? null : tag })}
                  >
                    {tag}
                    <span className="text-[10px] opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
