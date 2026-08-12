import { useCallback, useState } from "react";

import { useChat } from "../../../stores/chatStore";
import { useAuth } from "../../../stores/authStore";
import { generateExcerpt } from "../utils/blogExcerpt";

import type { ChangeEvent } from "react";
import type { BlogPost } from "@/types/blog";

import { uploadFile } from "@/api/chat";
import { createBlogPost, generateBlogCover, suggestBlogTags } from "@/api/blog";
import { errorMessage } from "@/lib/errors";

// 封面标签子领域：封面上传/AI 生成 + 标签 AI 生成。
// coverImage/tags 是核心表单字段（发布/自动保存等多处用），仍由主组件持有；
// hook 仅持有生成态瞬态，通过回调写回表单值与错误。行为不变。
export interface UseBlogCoverParams {
  existingPost: BlogPost | undefined;
  title: string;
  getContent: () => string;
  onError: (message: string | null) => void;
  onCoverChange: (coverImage: string) => void;
  onTagsChange: (tags: string) => void;
}

export function useBlogCover({ existingPost, title, getContent, onError, onCoverChange, onTagsChange }: UseBlogCoverParams) {
  const { state, dispatch } = useChat();
  const { user } = useAuth();
  const username = user?.username;
  const [generatingCover, setGeneratingCover] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [tagGenerating, setTagGenerating] = useState(false);

  const handleUploadCover = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError("请选择图片文件");
      return;
    }
    setUploadingCover(true);
    onError(null);
    try {
      const uploaded = await uploadFile(file);
      const coverUrl = username
        ? `/api/v1/public/uploads/${encodeURIComponent(username)}/${encodeURIComponent(uploaded.stored_name)}`
        : uploaded.download_url;
      onCoverChange(coverUrl);
    } catch {
      onError("上传封面失败，请确认图片格式后重试");
    } finally {
      setUploadingCover(false);
    }
  }, [onError, onCoverChange, username]);

  const handleGenerateCover = useCallback(async () => {
    if (!existingPost) {
      onError("请先保存文章，再使用 AI 生成封面");
      return;
    }
    setGeneratingCover(true);
    onError(null);
    try {
      const updated = await generateBlogCover(existingPost.id);
      onCoverChange(updated.cover_image || "");
      dispatch({
        type: "SET_BLOG_POSTS",
        payload: state.blogPosts.map((p) => (p.id === existingPost.id ? { ...p, ...updated } : p)),
      });
    } catch (err) {
      const detail = errorMessage(err, "");
      onError(detail ? `AI 生成封面失败：${detail}` : "AI 生成封面失败，请检查图片模型配置后重试");
    } finally {
      setGeneratingCover(false);
    }
  }, [existingPost, state.blogPosts, dispatch, onError, onCoverChange]);

  const handleSuggestTags = useCallback(async () => {
    const currentContent = getContent();
    if (!currentContent.trim()) {
      onError("请先输入文章内容，再生成标签");
      return;
    }
    let postId = existingPost?.id;
    setTagGenerating(true);
    onError(null);
    try {
      if (!postId) {
        const data = {
          title: title.trim() || "未命名草稿",
          content: currentContent,
          excerpt: generateExcerpt(currentContent),
          status: "draft" as const,
        };
        const created = await createBlogPost(data);
        dispatch({ type: "SET_BLOG_POSTS", payload: [created, ...state.blogPosts] });
        dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: created.id });
        postId = created.id;
      }
      const suggested = await suggestBlogTags(postId);
      if (suggested.length > 0) {
        onTagsChange(suggested.join(", "));
      } else {
        onError("未能生成有效标签，请手动输入");
      }
    } catch (err) {
      onError(errorMessage(err, "AI 生成标签失败"));
    } finally {
      setTagGenerating(false);
    }
  }, [getContent, title, existingPost, state.blogPosts, dispatch, onError, onTagsChange]);

  return {
    generatingCover,
    uploadingCover,
    tagGenerating,
    handleUploadCover,
    handleGenerateCover,
    handleSuggestTags,
  };
}
