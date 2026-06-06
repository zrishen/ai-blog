import { Component, createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Navigate, Route, Routes, matchPath, useLocation } from "react-router-dom";
import { useChat } from "./stores/chatStore";
import { useAuth } from "./stores/authStore";
import { NavBar } from "./components/NavBar";
import { LeftSidebar } from "./components/LeftSidebar";
import { AISidebar } from "./features/ai-chat/AISidebar";
import { SiteBlogRoute } from "./features/blog/SiteBlogRoute";
import { SitePostRoute } from "./features/blog/SitePostRoute";
import { LandingPage } from "./features/landing/LandingPage";
import { KnowledgeBasePage } from "./features/knowledge-base/KnowledgeBasePage";
import { ResearchGraphPage } from "./features/research/ResearchGraphPage";
import { MCPModal } from "./components/MCPModal";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, useGroupCallbackRef } from "react-resizable-panels";
import "./App.css";

const LAYOUT_STORAGE_KEY = "app-panel-layout";

function loadPanelLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw) {
      const { leftSize, aiOpenSize } = JSON.parse(raw);
      return { leftSize: leftSize ?? 20, aiOpenSize: aiOpenSize ?? 20 };
    }
  } catch {}
  return { leftSize: 20, aiOpenSize: 20 };
}

function savePanelLayout(leftSize: number, aiOpenSize: number) {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ leftSize, aiOpenSize }));
}

type PanelGroupAPI = {
  getLayout: () => Record<string, number>;
  setLayout: (sizes: Record<string, number>) => void;
} | null;

const PanelGroupCtx = createContext<PanelGroupAPI>(null);
export const usePanelGroupCtx = () => useContext(PanelGroupCtx);

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: "#ef4444", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
          <h2>App Crashed</h2>
          <p>{this.state.error.message}</p>
          <pre>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function KnowledgeRoute() {
  const { dispatch } = useChat();

  useEffect(() => {
    dispatch({ type: "SET_PAGE", payload: "knowledge" });
  }, [dispatch]);

  return <KnowledgeBasePage />;
}

function ResearchRoute() {
  const { dispatch } = useChat();

  useEffect(() => {
    dispatch({ type: "SET_PAGE", payload: "research" });
  }, [dispatch]);

  return <ResearchGraphPage />;
}

function MainContent() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/knowledge" element={<KnowledgeRoute />} />
      <Route path="/research" element={<ResearchRoute />} />
      <Route path="/research/:topicId" element={<ResearchRoute />} />
      <Route path="/u/:username" element={<SiteBlogRoute />} />
      <Route path="/u/:username/posts/:slug" element={<SitePostRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function useAISidebarRouteContext() {
  const location = useLocation();
  const { state } = useChat();
  const { isAuthenticated } = useAuth();

  return useMemo(() => {
    const postMatch = matchPath("/u/:username/posts/:slug", location.pathname);
    const siteMatch = matchPath("/u/:username", location.pathname);
    const siteUsername = postMatch?.params.username ?? siteMatch?.params.username;
    const postSlug = postMatch?.params.slug;

    if (location.pathname === "/") {
      const currentPost = state.blogCurrentPostId
        ? state.blogPosts.find((p) => p.id === state.blogCurrentPostId)
        : undefined;

      if (currentPost) {
        return {
          mode: isAuthenticated ? "private" as const : "shared" as const,
          contextText: `当前上下文：${currentPost.title}`,
          siteUsername: undefined,
          postSlug: currentPost.slug,
          pageType: "post" as const,
          postTitle: currentPost.title,
        };
      }

      return {
        mode: isAuthenticated ? "private" as const : "shared" as const,
        contextText: "当前上下文：AI Blog 项目介绍 - 基于 AI 的博客写作与知识管理平台",
        siteUsername: undefined,
        postSlug: undefined,
        pageType: "home" as const,
        postTitle: undefined,
      };
    }

    if (location.pathname === "/knowledge") {
      return {
        mode: isAuthenticated ? "private" as const : "shared" as const,
        contextText: "当前上下文：知识库",
        siteUsername: undefined,
        postSlug: undefined,
        pageType: "kb" as const,
        postTitle: undefined,
      };
    }

    if (location.pathname.startsWith("/research")) {
      const topicTitle = state.researchCurrentTopic?.title;
      return {
        mode: isAuthenticated ? "private" as const : "shared" as const,
        contextText: topicTitle ? `当前上下文：研究图谱 · ${topicTitle}` : "当前上下文：研究图谱",
        siteUsername: undefined,
        postSlug: undefined,
        pageType: "research" as const,
        postTitle: undefined,
      };
    }

    if (postMatch && siteUsername) {
      const post = state.blogPosts.find((item) => item.slug === postSlug || item.id === state.blogCurrentPostId);
      return {
        mode: isAuthenticated ? "private" as const : "shared" as const,
        contextText: post ? `当前上下文：${post.title}` : `当前上下文：${siteUsername} 的文章`,
        siteUsername,
        postSlug,
        pageType: "post" as const,
        postTitle: post?.title,
      };
    }

    if (siteMatch && siteUsername) {
      return {
        mode: isAuthenticated ? "private" as const : "shared" as const,
        contextText: `当前上下文：${siteUsername} 的博客主页`,
        siteUsername,
        postSlug: undefined,
        pageType: "other" as const,
        postTitle: undefined,
      };
    }

    return {
      mode: isAuthenticated ? "private" as const : "shared" as const,
      contextText: "",
      siteUsername: undefined,
      postSlug: undefined,
      pageType: "other" as const,
      postTitle: undefined,
    };
  }, [isAuthenticated, location.pathname, state.blogCurrentPostId, state.blogPosts, state.researchCurrentTopic?.title]);
}

function App() {
  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const { state } = useChat();
  const aiContext = useAISidebarRouteContext();
  const [groupApi, groupRef] = useGroupCallbackRef();
  const persisted = useRef(loadPanelLayout());
  const lastOpenAiSizeRef = useRef(persisted.current.aiOpenSize);
  const leftSizeRef = useRef(persisted.current.leftSize);
  useEffect(() => {
    if (!groupApi) return;
    const aiSize = state.aiSidebarOpen ? lastOpenAiSizeRef.current : 4;
    const leftSize = leftSizeRef.current;
    groupApi.setLayout({ left: leftSize, main: 100 - leftSize - aiSize, ai: aiSize });
  }, [groupApi, state.aiSidebarOpen]);

  const panelGroupValue = groupApi ?? null;

  return (
    <ErrorBoundary>
      <div className="app-root">
        <NavBar />
        <PanelGroupCtx.Provider value={panelGroupValue}>
          <PanelGroup
            orientation="horizontal"
            className="app-body"
            groupRef={groupRef}
            onLayoutChanged={(layout) => {
              const leftSize = layout.left;
              const aiSize = layout.ai;
              leftSizeRef.current = leftSize;
              if (aiSize > 5) {
                lastOpenAiSizeRef.current = aiSize;
              }
              savePanelLayout(leftSize, lastOpenAiSizeRef.current);
            }}
          >
            <Panel id="left" defaultSize={`${persisted.current.leftSize}%`} minSize="10%" maxSize="40%">
              <LeftSidebar />
            </Panel>
            <PanelResizeHandle className="w-[6px] -ml-[3px] -mr-[3px] relative z-10 cursor-col-resize group">
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border/60 group-hover:w-[2px] group-hover:bg-primary/40 group-active:bg-primary/60 transition-all" />
            </PanelResizeHandle>
            <Panel id="main" defaultSize={`${100 - persisted.current.leftSize - persisted.current.aiOpenSize}%`} minSize="40%">
              <main className="main-content">
                <MainContent />
              </main>
            </Panel>
            <PanelResizeHandle className="w-[6px] -ml-[3px] -mr-[3px] relative z-10 cursor-col-resize group">
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border/60 group-hover:w-[2px] group-hover:bg-primary/40 group-active:bg-primary/60 transition-all" />
            </PanelResizeHandle>
            <Panel
              id="ai"
              collapsible
              collapsedSize="4%"
              defaultSize={state.aiSidebarOpen ? `${persisted.current.aiOpenSize}%` : "4%"}
              minSize="10%"
              maxSize="50%"
            >
              <AISidebar {...aiContext} />
            </Panel>
          </PanelGroup>
        </PanelGroupCtx.Provider>

        {state.mcpModalOpen && <MCPModal />}
      </div>
    </ErrorBoundary>
  );
}

export default App;
