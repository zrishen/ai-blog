import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Outlet, Route, Routes, matchPath, useLocation } from "react-router-dom";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, useGroupCallbackRef } from "react-resizable-panels";

import { useChatState, useChatDispatch } from "./stores/chatStore";
import { useAuth } from "./stores/authStore";
import { NavBar } from "./components/NavBar";
import { LeftSidebar } from "./components/LeftSidebar";
import { MobileDrawer } from "./components/MobileDrawer";
import { useWorkspacePrimaryNavigation } from "./components/useWorkspacePrimaryNavigation";
import { AISidebar } from "./features/ai-chat";
import { SiteBlogRoute, SitePostRoute } from "./features/blog";
import { LandingPage } from "./features/landing";
import { WorkspacePage } from "./features/workspace";
import { BrainPage } from "./features/brain";
import { OverviewPage, UsersPage, CodesPage, UsagePage } from "./features/admin";
import { VisualRegressionRoute } from "./components/VisualRegressionRoute";
import { useMediaQuery } from "./hooks/useMediaQuery";
import "./App.css";
import { LoginDialog } from "./components/auth/LoginDialog";
import { cn } from "./lib/utils";
import { navItemVariants } from "./lib/visualVariants";

const LAYOUT_STORAGE_KEY = "app-panel-layout";
const MOBILE_WORKSPACE_QUERY = "(max-width: 767px)";

function loadPanelLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { leftSize?: number; aiOpenSize?: number };
      return { leftSize: parsed.leftSize ?? 20, aiOpenSize: parsed.aiOpenSize ?? 20 };
    }
  } catch {
    /* ignore malformed layout JSON */
  }
  return { leftSize: 20, aiOpenSize: 20 };
}

function savePanelLayout(leftSize: number, aiOpenSize: number) {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ leftSize, aiOpenSize }));
}

function WorkspaceRoute() {
  const dispatch = useChatDispatch();

  useEffect(() => {
    dispatch({ type: "SET_PAGE", payload: "workspace" });
    // 进工作区重置内联编辑 / 文件预览态，避免从别处带入
    dispatch({ type: "SET_WORKSPACE_EDITING_BLOG", payload: null });
    dispatch({ type: "SET_FILE_SELECTED_FILE", payload: null });
  }, [dispatch]);

  return <WorkspacePage />;
}

function BrainRoute() {
  const dispatch = useChatDispatch();

  useEffect(() => {
    dispatch({ type: "SET_PAGE", payload: "brain" });
  }, [dispatch]);

  return <BrainPage />;
}

function AdminLayout() {
  const dispatch = useChatDispatch();
  const { user, isInitializing } = useAuth();
  const canAccessAdmin = Boolean(user?.is_admin || user?.is_super_admin);
  useEffect(() => {
    if (canAccessAdmin) dispatch({ type: "SET_PAGE", payload: "admin" });
  }, [canAccessAdmin, dispatch]);
  // 刷新时先等待 Cookie 会话恢复，避免权限尚未加载便误跳回首页。
  if (isInitializing) return null;
  if (!canAccessAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

function MainContent() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/workspace" element={<WorkspaceRoute />} />
      <Route path="/brain" element={<BrainRoute />} />
      <Route path="/u/:username" element={<SiteBlogRoute />} />
      <Route path="/u/:username/posts/:slug" element={<SitePostRoute />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="codes" element={<CodesPage />} />
        <Route path="usage" element={<UsagePage />} />
      </Route>
      {import.meta.env.DEV && <Route path="/__visual-regression" element={<VisualRegressionRoute />} />}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function useAISidebarRouteContext() {
  const location = useLocation();
  const state = useChatState();
  const { isAuthenticated, isInitializing } = useAuth();

  return useMemo(() => {
    const mode = isInitializing ? "pending" as const : isAuthenticated ? "private" as const : "shared" as const;
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
          mode,
          contextText: `当前上下文：${currentPost.title}`,
          siteUsername: undefined,
          postSlug: currentPost.slug,
          pageType: "post" as const,
          postTitle: currentPost.title,
        };
      }

      return {
        mode,
        contextText: "当前上下文：AI Blog 项目介绍 - 基于 AI 的博客写作与知识管理平台",
        siteUsername: undefined,
        postSlug: undefined,
        pageType: "home" as const,
        postTitle: undefined,
      };
    }

    if (postMatch && siteUsername) {
      const post = state.blogPosts.find((item) => item.slug === postSlug || item.id === state.blogCurrentPostId);
      return {
        mode,
        contextText: post ? `当前上下文：${post.title}` : `当前上下文：${siteUsername} 的文章`,
        siteUsername,
        postSlug,
        pageType: "post" as const,
        postTitle: post?.title,
      };
    }

    if (siteMatch && siteUsername) {
      return {
        mode,
        contextText: `当前上下文：${siteUsername} 的博客主页`,
        siteUsername,
        postSlug: undefined,
        pageType: "other" as const,
        postTitle: undefined,
      };
    }

    return {
      mode,
      contextText: "",
      siteUsername: undefined,
      postSlug: undefined,
      pageType: "other" as const,
      postTitle: undefined,
    };
  }, [isAuthenticated, isInitializing, location.pathname, state.blogCurrentPostId, state.blogPosts]);
}

function App() {
  const location = useLocation();

  if (location.pathname === "/") {
    return <LandingPage />;
  }

  return <AuthenticatedApp />;
}

type AISidebarRouteContext = ReturnType<typeof useAISidebarRouteContext>;

function MobileWorkspaceNavigation({ onNavigate }: { onNavigate: () => void }) {
  const state = useChatState();
  const { isAuthenticated } = useAuth();
  const {
    activePrimaryPage,
    primaryNavigation,
    loginDialogOpen,
    setLoginDialogOpen,
    handleLoginSuccess,
  } = useWorkspacePrimaryNavigation();
  const showContextPanel = isAuthenticated || state.currentPage === "blog";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <nav aria-label="工作区主导航" className="shrink-0 border-b border-border/70 p-3">
        <p className="px-2 pb-2 text-caption font-bold uppercase tracking-[0.14em] text-muted-foreground">主导航</p>
        <div className="space-y-1">
          {primaryNavigation.map(({ key, label, icon: Icon, onClick }) => (
            <button
              key={key}
              type="button"
              aria-current={activePrimaryPage === key ? "page" : undefined}
              className={cn(navItemVariants({ layout: "side", state: activePrimaryPage === key ? "active" : "idle" }))}
              onClick={() => {
                onClick();
                onNavigate();
              }}
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>
      {showContextPanel && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <LeftSidebar />
        </div>
      )}
      <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} onSuccess={handleLoginSuccess} />
    </div>
  );
}

function MobileWorkspace({ aiContext }: { aiContext: AISidebarRouteContext }) {
  const [mobileDrawer, setMobileDrawer] = useState<"navigation" | "ai" | null>(null);
  const openNavigationButtonRef = useRef<HTMLButtonElement>(null);
  const openAIButtonRef = useRef<HTMLButtonElement>(null);
  const closeMobileDrawer = useCallback(() => setMobileDrawer(null), []);
  const openMobileNavigation = useCallback(() => setMobileDrawer("navigation"), []);
  const openMobileAI = useCallback(() => setMobileDrawer("ai"), []);

  return (
    <>
      <NavBar
        onOpenNavigation={openMobileNavigation}
        onOpenAI={openMobileAI}
        navigationButtonRef={openNavigationButtonRef}
        aiButtonRef={openAIButtonRef}
      />
      <main className="main-content app-body mobile-workspace-main">
        <MainContent />
      </main>
      <MobileDrawer
        open={mobileDrawer === "navigation"}
        side="left"
        title="工作区导航"
        onOpenChange={(open) => setMobileDrawer(open ? "navigation" : null)}
        returnFocusRef={openNavigationButtonRef}
        swipeEnabled={mobileDrawer === null || mobileDrawer === "navigation"}
      >
        <MobileWorkspaceNavigation onNavigate={closeMobileDrawer} />
      </MobileDrawer>
      <MobileDrawer
        open={mobileDrawer === "ai"}
        side="right"
        title="AI 助手"
        onOpenChange={(open) => setMobileDrawer(open ? "ai" : null)}
        returnFocusRef={openAIButtonRef}
        swipeEnabled={mobileDrawer === null || mobileDrawer === "ai"}
      >
        <AISidebar {...aiContext} forceExpanded onRequestClose={closeMobileDrawer} />
      </MobileDrawer>
    </>
  );
}

function AuthenticatedApp() {
  const state = useChatState();
  const { isInitializing } = useAuth();
  const aiContext = useAISidebarRouteContext();
  const isMobileWorkspace = useMediaQuery(MOBILE_WORKSPACE_QUERY);
  const [groupApi, groupRef] = useGroupCallbackRef();
  const [initialLayout] = useState(loadPanelLayout);
  const lastOpenAiSizeRef = useRef(initialLayout.aiOpenSize);
  const leftSizeRef = useRef(initialLayout.leftSize);

  useEffect(() => {
    if (!groupApi || isMobileWorkspace) return;
    const aiPanelSize = state.aiSidebarOpen ? lastOpenAiSizeRef.current : 4;
    const leftSize = leftSizeRef.current;
    groupApi.setLayout({ left: leftSize, main: 100 - leftSize - aiPanelSize, ai: aiPanelSize });
  }, [groupApi, isMobileWorkspace, state.aiSidebarOpen]);

  // 登出清除面板布局：与 ws_view 一致的跨账号清理模式
  useEffect(() => {
    const clear = () => {
      try { localStorage.removeItem(LAYOUT_STORAGE_KEY); } catch { /* ignore unavailable storage */ }
    };
    window.addEventListener("auth:logout", clear);
    return () => window.removeEventListener("auth:logout", clear);
  }, []);

  // 刷新页面后 access token（仅存内存）丢失，AuthProvider 正用 HttpOnly cookie 换新 token（isInitializing 期间）。
  // 此时暂不渲染，避免 LeftSidebar / MainContent 等子组件的 effect 在 token 就绪前发请求触发批量 401，
  // 也避免与 apiFetch 的 refreshOnce 并发抢刷新。
  if (isInitializing) return null;

  return (
    <div className="app-root">
        {isMobileWorkspace ? (
          <MobileWorkspace aiContext={aiContext} />
        ) : (
          <>
            <NavBar />
            <PanelGroup
              orientation="horizontal"
              className="app-body"
              groupRef={groupRef}
              onLayoutChanged={(layout) => {
                const leftSize = layout.left;
                const aiSize = layout.ai;
                if (typeof leftSize === "number") {
                  leftSizeRef.current = leftSize;
                }
                if (aiSize > 5) {
                  lastOpenAiSizeRef.current = aiSize;
                }
                savePanelLayout(leftSizeRef.current, lastOpenAiSizeRef.current);
              }}
            >
              <Panel id="left" defaultSize={`${initialLayout.leftSize}%`} minSize="10%" maxSize="40%">
                <LeftSidebar />
              </Panel>
              <PanelResizeHandle className="w-[6px] -ml-[3px] -mr-[3px] relative z-10 cursor-col-resize group">
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border/60 group-hover:w-[2px] group-hover:bg-primary/40 group-active:bg-primary/60 transition-all" />
              </PanelResizeHandle>
              <Panel id="main" defaultSize={`${100 - initialLayout.leftSize - initialLayout.aiOpenSize}%`} minSize="40%">
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
                defaultSize={state.aiSidebarOpen ? `${initialLayout.aiOpenSize}%` : "4%"}
                minSize="10%"
                maxSize="50%"
              >
                <AISidebar {...aiContext} />
              </Panel>
              </PanelGroup>
          </>
        )}

      </div>
  );
}

export default App;
