import { useChat } from "../stores/chatStore";
import { BlogTocPanel } from "../features/blog/components/BlogTocPanel";
import { FilePanel } from "../features/file/components/FilePanel";
import { ResearchPanel } from "../features/research/ResearchPanel";
import { BlogOverviewPanel } from "../features/blog/components/BlogOverviewPanel";

export function LeftSidebar() {
  const { state } = useChat();

  if (state.currentPage === "blog" && state.blogCurrentView === "view") {
    return <BlogTocPanel mode="view" />;
  }

  if (state.currentPage === "blog" && state.blogCurrentView === "edit") {
    return <BlogTocPanel mode="edit" />;
  }

  if (state.currentPage === "files") {
    return <FilePanel />;
  }

  if (state.currentPage === "research") {
    return <ResearchPanel />;
  }

  return <BlogOverviewPanel />;
}
