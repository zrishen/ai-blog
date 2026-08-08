import { useChat } from "../stores/chatStore";
import { BlogTocPanel, BlogOverviewPanel } from "../features/blog";
import { BrainNav } from "../features/brain";
import { WorkspaceNav } from "../features/workspace";
import { AdminNav } from "../features/admin";

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
