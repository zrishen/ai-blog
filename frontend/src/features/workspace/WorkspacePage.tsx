import { useCallback, useState } from "react";

import { useChat } from "../../stores/chatStore";
import { getBlogPost } from "@/api/blog";
import { BlogEditor } from "../blog";
import { FilePreviewView } from "./views/FilePreviewView";
import { OverviewView } from "./views/OverviewView";
import { BlogPostsView } from "./views/BlogPostsView";
import { AiKnowledgeView } from "./views/AiKnowledgeView";
import { TrashView } from "./views/TrashView";
import { FolderView } from "./views/FolderView";

export function WorkspacePage() {
  const { state, dispatch } = useChat();
  const view = state.workspaceSelectedView;
  const [isCreatingBlog, setIsCreatingBlog] = useState(false);

  // 工作区内联打开博客编辑：拉取单篇塞入 store，设编辑态 + 当前文章，中柱切到 BlogEditor
  //（不跳路由、不改 page/view，目录树常驻）。
  const openBlog = useCallback(
    async (id: number) => {
      setIsCreatingBlog(false);
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
    () => {
      setIsCreatingBlog(false);
      dispatch({ type: "SET_WORKSPACE_EDITING_BLOG", payload: null });
    },
    [dispatch],
  );

  const createBlog = useCallback(() => {
    setIsCreatingBlog(true);
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
    dispatch({ type: "SET_WORKSPACE_EDITING_BLOG", payload: null });
    dispatch({ type: "SET_FILE_SELECTED_FILE", payload: null });
  }, [dispatch]);

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

  // 内联编辑：editingBlogId 命中 blogPosts 时中柱渲染 BlogEditor（目录树常驻）
  const editingPost =
    state.workspaceEditingBlogId != null
      ? state.blogPosts.find((p) => p.id === state.workspaceEditingBlogId)
      : undefined;
  if (editingPost || isCreatingBlog) return <BlogEditor onBack={exitBlogEdit} />;

  if (state.fileSelectedFile) return <FilePreviewView onBack={exitFilePreview} />;

  if (state.workspaceSelectedFolderPath) {
    return (
      <FolderView
        folderPath={state.workspaceSelectedFolderPath}
        onOpenBlog={openBlog}
        onOpenFile={openFile}
        onBack={() => dispatch({ type: "SET_WORKSPACE_SELECTED_FOLDER_PATH", payload: null })}
      />
    );
  }

  if (view === "trash") return <TrashView />;

  switch (view) {
    case "overview":
      return <OverviewView onOpenBlog={openBlog} onOpenFile={openFile} />;
    case "drafts":
      return <BlogPostsView key={view} status="draft" title="草稿" onOpen={openBlog} onCreate={createBlog} />;
    case "published":
      return <BlogPostsView key={view} status="published" title="已发布" onOpen={openBlog} onCreate={createBlog} />;
    case "ai_knowledge":
      return <AiKnowledgeView onOpenBlog={openBlog} onOpenFile={openFile} />;
    default:
      return <OverviewView onOpenBlog={openBlog} onOpenFile={openFile} />;
  }
}
