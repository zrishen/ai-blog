import { useChat } from "../stores/chatStore";
import { BlogTocPanel } from "../features/blog/components/BlogTocPanel";
import { BrainNav } from "../features/brain/BrainNav";
import { BlogOverviewPanel } from "../features/blog/components/BlogOverviewPanel";
import { WorkspaceNav } from "../features/workspace/WorkspaceNav";
import { AdminNav } from "../features/admin/components/AdminNav";

export function LeftSidebar() {
  const { state } = useChat();

  if (state.currentPage === "workspace") {
    return <WorkspaceNav />;
  }

  if (state.currentPage === "admin") {
    return <AdminNav />;
  }

  if (state.currentPage === "blog" && state.blogCurrentView === "view") {
    return <BlogTocPanel mode="view" />;
  }

  if (state.currentPage === "blog" && state.blogCurrentView === "edit") {
    return <BlogTocPanel mode="edit" />;
  }

  if (state.currentPage === "brain") {
    return <BrainNav />;
  }

  return <BlogOverviewPanel />;
}
