import { useCallback } from "react";

import { useChat } from "../../stores/chatStore";
import { getBlogPost } from "../../api/client";
import { BlogEditor } from "../blog/components/BlogEditor";
import { FilePreviewView } from "./views/FilePreviewView";
import { OverviewView } from "./views/OverviewView";
import { BlogPostsView } from "./views/BlogPostsView";
import { UnarchivedView } from "./views/UnarchivedView";
import { AiKnowledgeView } from "./views/AiKnowledgeView";
import { FolderView } from "./views/FolderView";
import { TrashView } from "./views/TrashView";

export function WorkspacePage() {
  const { state, dispatch } = useChat();
  const folderId = state.workspaceSelectedFolderId;
  const view = state.workspaceSelectedView;

  // 工作区内联打开博客编辑：拉取单篇塞入 store，设编辑态 + 当前文章，中柱切到 BlogEditor
  //（不跳路由、不改 page/view，目录树常驻）。
  const openBlog = useCallback(
    async (id: number) => {
      try {
        const post = await getBlogPost(id);
        dispatch({ type: "UPSERT_BLOG_POST", payload: post });
      } catch {
        /* 忽略，仍尝试用本地缓存编辑 */
      }
      dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: id });
      dispatch({ type: "SET_WORKSPACE_EDITING_BLOG", payload: id });
    },
    [dispatch],
  );

  const exitBlogEdit = useCallback(
    () => dispatch({ type: "SET_WORKSPACE_EDITING_BLOG", payload: null }),
    [dispatch],
  );

  const openFile = useCallback(
    (filePath: string) => {
      dispatch({ type: "SET_FILE_SELECTED_FILE", payload: filePath });
    },
    [dispatch],
  );

  const exitFilePreview = useCallback(
    () => dispatch({ type: "SET_FILE_SELECTED_FILE", payload: null }),
    [dispatch],
  );

  const exitFolder = useCallback(
    () => dispatch({ type: "SET_WORKSPACE_SELECTED_FOLDER", payload: null }),
    [dispatch],
  );

  // 内联编辑：editingBlogId 命中 blogPosts 时中柱渲染 BlogEditor（目录树常驻）
  const editingPost =
    state.workspaceEditingBlogId != null
      ? state.blogPosts.find((p) => p.id === state.workspaceEditingBlogId)
      : undefined;
  if (editingPost) return <BlogEditor onBack={exitBlogEdit} />;

  if (state.fileSelectedFile) return <FilePreviewView onBack={exitFilePreview} />;

  if (folderId != null)
    return (
      <FolderView
        folderId={folderId}
        onOpenBlog={openBlog}
        onOpenFile={openFile}
        onBack={exitFolder}
      />
    );
  if (view === "trash") return <TrashView />;

  switch (view) {
    case "overview":
      return <OverviewView onOpenBlog={openBlog} />;
    case "drafts":
      return <BlogPostsView status="draft" title="草稿" onOpen={openBlog} />;
    case "published":
      return <BlogPostsView status="published" title="已发布" onOpen={openBlog} />;
    case "inbox":
      return <UnarchivedView onOpenFile={openFile} onOpenBlog={openBlog} />;
    case "ai_knowledge":
      return <AiKnowledgeView onOpenBlog={openBlog} onOpenFile={openFile} />;
    default:
      return <OverviewView onOpenBlog={openBlog} />;
  }
}
