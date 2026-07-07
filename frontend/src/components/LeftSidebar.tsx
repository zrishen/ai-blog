import { useChat } from "../stores/chatStore";
import { BlogTocPanel } from "./left-sidebar/BlogTocPanel";
import { KnowledgePanel } from "./left-sidebar/KnowledgePanel";
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

  if (state.currentPage === "knowledge") {
    return <KnowledgePanel />;
  }

  if (state.currentPage === "research") {
    return <ResearchPanel />;
  }

  return <BlogOverviewPanel />;
}
