import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "../../../stores/chatStore";
import { deleteBlogPost, getBlogPost, listBlogPosts } from "../../../api/client";
import type { BlogPost } from "../types";
import { formatSaveTime, type DraftInfo } from "../utils/blogEditorTypes";

// 草稿子领域：本地自动保存 + 服务端草稿列表加载/删除 + 取消时的保存确认弹窗。
// 表单字段（title/content/tags/coverImage）仍由主组件持有：自动保存读取它们，
// 加载草稿时通过 applyDraft 回调写回（含 Vditor setValue，桥接逻辑留在主组件）。
// draftKey 同步返回，供主组件 handleSave/ensurePostId 清理本地缓存。行为不变。
export interface UseBlogDraftsParams {
  existingPost: BlogPost | undefined;
  title: string;
  content: string;
  tags: string;
  coverImage: string;
  isDirtyRef: { current: boolean };
  applyDraft: (post: BlogPost) => void;
  exitEditor: () => void;
  onError: (message: string | null) => void;
}

export function useBlogDrafts({
  existingPost,
  title,
  content,
  tags,
  coverImage,
  isDirtyRef,
  applyDraft,
  exitEditor,
  onError,
}: UseBlogDraftsParams) {
  const { state, dispatch } = useChat();
  const [drafts, setDrafts] = useState<DraftInfo[]>([]);
  const [draftPanelPos, setDraftPanelPos] = useState({ top: 0, left: 0 });
  const [showDraftList, setShowDraftList] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftDeleting, setDraftDeleting] = useState(false);
  const [draftDeleteTarget, setDraftDeleteTarget] = useState<DraftInfo | null>(null);
  const [lastSaved, setLastSaved] = useState("");
  const [showCancelModal, setShowCancelModal] = useState(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftBtnRef = useRef<HTMLDivElement>(null);
  const draftKey = `draft_blog_${existingPost?.id || "new"}`;

  useEffect(() => {
    if (!title.trim() && !content.trim() && !coverImage) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      localStorage.setItem(draftKey, JSON.stringify({
        title, content, tags, coverImage,
        _savedAt: new Date().toISOString(),
      }));
      setLastSaved(formatSaveTime());
    }, 2000);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [title, content, tags, coverImage, draftKey]);

  const loadDraftList = useCallback(async () => {
    if (showDraftList) {
      setShowDraftList(false);
      return;
    }

    onError(null);
    try {
      const data = await listBlogPosts({ status: "draft", per_page: 50 });
      const serverDrafts: DraftInfo[] = data.posts.map((post) => ({
        id: post.id,
        title: post.title || "未命名草稿",
        time: post.updated_at || post.created_at || "",
      }));
      setDrafts(serverDrafts);
      if (draftBtnRef.current) {
        const rect = draftBtnRef.current.getBoundingClientRect();
        setDraftPanelPos({ top: rect.bottom + 8, left: rect.right - 340 });
      }
      setShowDraftList(true);
    } catch {
      setDrafts([]);
      setShowDraftList(true);
      onError("草稿列表加载失败，请稍后重试");
    }
  }, [showDraftList, onError]);

  const handleLoadDraft = useCallback(async (draft: DraftInfo) => {
    setDraftLoading(true);
    try {
      const post = await getBlogPost(draft.id);
      dispatch({
        type: "SET_BLOG_POSTS",
        payload: state.blogPosts.some((p) => p.id === post.id)
          ? state.blogPosts.map((p) => (p.id === post.id ? { ...p, ...post } : p))
          : [post, ...state.blogPosts],
      });
      dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: post.id });
      applyDraft(post);
      onError(null);
      setShowDraftList(false);
    } catch {
      onError("草稿加载失败，请稍后重试");
    } finally {
      setDraftLoading(false);
    }
  }, [dispatch, state.blogPosts, applyDraft, onError]);

  const handleDeleteDraft = useCallback(async () => {
    if (!draftDeleteTarget) return;
    setDraftDeleting(true);
    try {
      await deleteBlogPost(draftDeleteTarget.id);
      setDrafts((prev) => prev.filter((d) => d.id !== draftDeleteTarget.id));
      dispatch({ type: "SET_BLOG_POSTS", payload: state.blogPosts.filter((p) => p.id !== draftDeleteTarget.id) });
      setDraftDeleteTarget(null);
    } catch {
      onError("删除草稿失败");
    } finally {
      setDraftDeleting(false);
    }
  }, [dispatch, draftDeleteTarget, state.blogPosts, onError]);

  const handleCancel = useCallback(() => {
    if (isDirtyRef.current) {
      setShowCancelModal(true);
    } else {
      localStorage.removeItem(draftKey);
      exitEditor();
    }
  }, [draftKey, exitEditor, isDirtyRef]);

  const handleSaveDraft = useCallback(() => {
    localStorage.setItem(draftKey, JSON.stringify({
      title, content, tags, coverImage,
      _savedAt: new Date().toISOString(),
    }));
    setShowCancelModal(false);
    exitEditor();
  }, [title, content, tags, coverImage, draftKey, exitEditor]);

  const handleDiscardDraft = useCallback(() => {
    localStorage.removeItem(draftKey);
    setShowCancelModal(false);
    exitEditor();
  }, [draftKey, exitEditor]);

  return {
    drafts,
    draftPanelPos,
    showDraftList,
    draftLoading,
    draftDeleting,
    draftDeleteTarget,
    setDraftDeleteTarget,
    lastSaved,
    draftBtnRef,
    draftKey,
    showCancelModal,
    setShowCancelModal,
    loadDraftList,
    handleLoadDraft,
    handleDeleteDraft,
    handleCancel,
    handleSaveDraft,
    handleDiscardDraft,
  };
}
