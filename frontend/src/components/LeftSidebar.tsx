import { useChat } from "../stores/chatStore";
import { BlogTocPanel } from "./left-sidebar/BlogTocPanel";
import { FilePanel } from "./left-sidebar/FilePanel";
import { ResearchPanel } from "./left-sidebar/ResearchPanel";
import { BlogOverviewPanel } from "./left-sidebar/BlogOverviewPanel";

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
