import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useChat, toggleTheme } from "../stores/chatStore";
import { useAuth } from "../stores/authStore";
import { motion } from "motion/react";
import {
  Sun,
  Moon,
  PenLine,
  Wrench,
  Sparkles,
  User,
  LogOut,
  BookOpen,
  Library,
  GitBranch,
  Home,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoginDialog } from "@/features/auth/LoginDialog";
import type { AuthUser } from "../stores/authStore";

export function NavBar() {
  const { state, dispatch } = useChat();
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginRedirectTarget, setLoginRedirectTarget] = useState<"knowledge" | "research" | null>(null);

  const isLandingPage = location.pathname === "/";
  const isKnowledgeActive = location.pathname === "/knowledge";
  const isResearchActive = location.pathname.startsWith("/research");
  const isBlogActive = location.pathname.startsWith("/u/");

  const resetBlogList = () => {
    dispatch({ type: "SET_PAGE", payload: "blog" });
    dispatch({ type: "SET_BLOG_VIEW", payload: "list" });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
  };

  const handleLandingHome = () => {
    resetBlogList();
    navigate("/");
  };

  const handleBlogHome = () => {
    resetBlogList();
    if (isAuthenticated && user?.username) {
      navigate(`/u/${encodeURIComponent(user.username)}`);
      return;
    }
    // 未登录时：如果在用户博客页则保持，否则跳转落地页
    const match = location.pathname.match(/^\/u\/([^/]+)/);
    if (match) {
      navigate(`/u/${match[1]}`);
      return;
    }
    navigate("/");
  };

  const handleKnowledge = () => {
    if (!isAuthenticated) {
      setLoginRedirectTarget("knowledge");
      setLoginDialogOpen(true);
      return;
    }
    dispatch({ type: "SET_PAGE", payload: "knowledge" });
    navigate("/knowledge");
  };

  const handleResearch = () => {
    if (!isAuthenticated) {
      setLoginRedirectTarget("research");
      setLoginDialogOpen(true);
      return;
    }
    dispatch({ type: "SET_PAGE", payload: "research" });
    navigate("/research");
  };

  const handleMyHome = () => {
    if (!user?.username) return;
    dispatch({ type: "SET_PAGE", payload: "blog" });
    dispatch({ type: "SET_BLOG_VIEW", payload: "list" });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
    navigate(`/u/${encodeURIComponent(user.username)}`);
  };

  const handleWritePost = () => {
    if (!isAuthenticated || !user?.username) {
      setLoginRedirectTarget(null);
      setLoginDialogOpen(true);
      return;
    }
    dispatch({ type: "SET_PAGE", payload: "blog" });
    dispatch({ type: "SET_BLOG_VIEW", payload: "edit" });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
    navigate(`/u/${encodeURIComponent(user.username)}`);
  };

  const handleMCPService = () => {
    dispatch({ type: "TOGGLE_MCP_MODAL", payload: true });
  };

  const handleLogout = () => {
    const username = user?.username;
    logout();
    dispatch({ type: "LOGOUT" });
    if (username) navigate(`/u/${encodeURIComponent(username)}`);
  };

  const handleLoginSuccess = (loggedInUser: AuthUser) => {
    if (loginRedirectTarget === "knowledge") {
      setLoginRedirectTarget(null);
      dispatch({ type: "SET_PAGE", payload: "knowledge" });
      navigate("/knowledge");
      return;
    }
    if (loginRedirectTarget === "research") {
      setLoginRedirectTarget(null);
      dispatch({ type: "SET_PAGE", payload: "research" });
      navigate("/research");
      return;
    }
    dispatch({ type: "SET_PAGE", payload: "blog" });
    dispatch({ type: "SET_BLOG_VIEW", payload: "list" });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
    navigate(`/u/${encodeURIComponent(loggedInUser.username)}`);
  };

  return (
    <nav className="h-14 flex-shrink-0 flex items-center bg-card/78 backdrop-blur-xl border-b border-border/80 px-4 gap-3 z-100 relative shadow-[0_10px_35px_hsl(var(--foreground)/0.05)] select-none">
      <button
        className="flex items-center gap-2.5 mr-3 cursor-pointer bg-transparent border-none group"
        onClick={handleLandingHome}
      >
        <span className="w-8 h-8 rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 flex items-center justify-center transition-transform group-hover:rotate-6 group-hover:scale-105">
          <Sparkles className="w-4 h-4" />
        </span>
        <span className="leading-tight text-left whitespace-nowrap">
          <span className="block text-[15px] font-black tracking-[-0.03em] text-foreground">
            AI Blog
          </span>
          <span className="block text-[10px] font-medium text-muted-foreground -mt-0.5">
            写作 · 知识 · 助手
          </span>
        </span>
      </button>

      <div className="flex-1" />

      {!isLandingPage && (
        <div className="absolute left-[10%] flex items-center gap-1 rounded-full border border-border/70 bg-secondary/70 p-1 shadow-inner">
          <Button
            variant={isBlogActive ? "default" : "ghost"}
            size="sm"
            className={`rounded-full gap-1.5 px-3.5 ${isBlogActive ? "shadow-md shadow-primary/20" : "text-muted-foreground hover:text-foreground"}`}
            onClick={handleBlogHome}
          >
            <BookOpen className="w-3.5 h-3.5" />
            首页
          </Button>
          <Button
            variant={isKnowledgeActive ? "default" : "ghost"}
            size="sm"
            className={`rounded-full gap-1.5 px-3.5 ${isKnowledgeActive ? "shadow-md shadow-primary/20" : "text-muted-foreground hover:text-foreground"}`}
            onClick={handleKnowledge}
          >
            <Library className="w-3.5 h-3.5" />
            知识库
          </Button>
          <Button
            variant={isResearchActive ? "default" : "ghost"}
            size="sm"
            className={`rounded-full gap-1.5 px-3.5 ${isResearchActive ? "shadow-md shadow-primary/20" : "text-muted-foreground hover:text-foreground"}`}
            onClick={handleResearch}
          >
            <GitBranch className="w-3.5 h-3.5" />
            研究图谱
          </Button>
        </div>
      )}

      <motion.div
        whileTap={{ rotate: 180, scale: 0.9 }}
        transition={{ duration: 0.3 }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full hover:bg-secondary"
          onClick={() => toggleTheme(dispatch)}
          title="切换主题"
        >
          {state.theme === "dark" ? (
            <Sun className="w-[18px] h-[18px]" />
          ) : (
            <Moon className="w-[18px] h-[18px]" />
          )}
        </Button>
      </motion.div>

      {isAuthenticated ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-secondary" title={user?.username}>
              <User className="w-[18px] h-[18px]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>{user?.username}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleMyHome}>
              <Home className="w-4 h-4 text-muted-foreground" />
              我的主页
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleWritePost}>
              <PenLine className="w-4 h-4 text-muted-foreground" />
              写文章
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleMCPService}>
              <Wrench className="w-4 h-4 text-muted-foreground" />
              MCP 服务
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="w-4 h-4 text-muted-foreground" />
              登出
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full hover:bg-secondary"
          onClick={() => {
            setLoginRedirectTarget(null);
            setLoginDialogOpen(true);
          }}
          title="用户"
        >
          <User className="w-[18px] h-[18px]" />
        </Button>
      )}

      <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} onSuccess={handleLoginSuccess} />
    </nav>
  );
}
