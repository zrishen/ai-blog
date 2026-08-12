import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  Sun,
  Moon,
  PenLine,
  User,
  LogOut,
  Home,
  Settings,
  Trash2,
  Menu,
  MessageSquare,
  Shield,
  CreditCard,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoginDialog } from "@/components/auth/LoginDialog";
import { LLMSettingsDialog } from "@/components/settings/LLMSettingsDialog";
import { SubscriptionPanel } from "@/features/subscription/SubscriptionPanel";
import { ProjectMark } from "@/components/ProjectMark";
import { cn } from "@/lib/utils";
import { navItemVariants } from "@/lib/visualVariants";
import { useWorkspacePrimaryNavigation } from "@/components/useWorkspacePrimaryNavigation";
import { useChat, toggleTheme } from "../stores/chatStore";
import { useAuth } from "../stores/authStore";

interface NavBarProps {
  onOpenNavigation?: () => void;
  onOpenAI?: () => void;
  navigationButtonRef?: React.Ref<HTMLButtonElement>;
  aiButtonRef?: React.Ref<HTMLButtonElement>;
}

export function NavBar({ onOpenNavigation, onOpenAI, navigationButtonRef, aiButtonRef }: NavBarProps = {}) {
  const { state, dispatch } = useChat();
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    activePrimaryPage,
    primaryNavigation,
    loginDialogOpen,
    setLoginDialogOpen,
    openLoginDialog,
    handleHome,
    handleLoginSuccess,
  } = useWorkspacePrimaryNavigation();
  const goTrash = () => {
    dispatch({ type: "SET_WORKSPACE_SELECTED_VIEW", payload: "trash" });
    dispatch({ type: "SET_WORKSPACE_EDITING_BLOG", payload: null });
    navigate("/workspace");
  };
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [subscriptionDialogOpen, setSubscriptionDialogOpen] = useState(false);

  const handleWritePost = () => {
    if (!isAuthenticated || !user?.username) {
      openLoginDialog();
      return;
    }
    dispatch({ type: "SET_PAGE", payload: "blog" });
    dispatch({ type: "SET_BLOG_VIEW", payload: "edit" });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
    navigate(`/u/${encodeURIComponent(user.username)}`, {
      state: { returnTo: `${location.pathname}${location.search}${location.hash}` },
    });
  };

  const handleLogout = () => {
    const username = user?.username;
    logout();
    dispatch({ type: "LOGOUT" });
    if (username) navigate(`/u/${encodeURIComponent(username)}`);
  };

  const handleAdmin = () => {
    dispatch({ type: "SET_PAGE", payload: "admin" });
    navigate("/admin");
  };

  const openSettingsDialog = () => setSettingsDialogOpen(true);

  return (
    <nav
      aria-label="应用顶栏"
      className="h-13 relative z-100 flex flex-shrink-0 select-none items-center gap-1.5 border-b border-border/80 bg-card/78 px-2.5 shadow-[0_10px_35px_hsl(var(--foreground)/0.05)] backdrop-blur-xl sm:gap-3 sm:px-4"
    >
      {onOpenNavigation && (
        <Button
          ref={navigationButtonRef}
          variant="ghost"
          size="icon"
          className="rounded-full md:hidden"
          onClick={onOpenNavigation}
          title="打开工作区导航"
          aria-label="打开工作区导航"
        >
          <Menu className="h-[18px] w-[18px]" />
        </Button>
      )}

      <button
        type="button"
        aria-label="返回首页"
        className="group mr-1 flex min-w-0 cursor-pointer items-center gap-2 border-none bg-transparent sm:mr-3 sm:gap-2.5"
        onClick={handleHome}
      >
        <span className="flex h-8 w-8 -rotate-6 items-center justify-center text-foreground transition-transform group-hover:-rotate-3 group-hover:scale-105">
          <ProjectMark className="h-7 w-7" />
        </span>
        <span
          className="hidden text-left whitespace-nowrap text-body-lg font-semibold tracking-[0.06em] text-foreground transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:scale-[1.03] sm:inline"
          style={{ fontFamily: '"Songti SC", "Noto Serif CJK SC", "STSong", "SimSun", serif' }}
        >
          把想法写成体系
        </span>
      </button>

      <div
        role="group"
        aria-label="主导航"
        className="hidden items-center gap-1.5 md:flex lg:absolute lg:left-1/2 lg:-translate-x-1/2"
      >
        {primaryNavigation.map(({ key, label, icon: Icon, onClick }) => {
          const isActive = activePrimaryPage === key;
          return (
            <button
              key={key}
              type="button"
              onClick={onClick}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                navItemVariants({ layout: "top", state: isActive ? "active" : "idle" }),
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1" />

      {onOpenAI && (
        <Button
          ref={aiButtonRef}
          variant="ghost"
          size="icon"
          className="rounded-full md:hidden"
          onClick={onOpenAI}
          title="打开 AI 助手"
          aria-label="打开 AI 助手"
        >
          <MessageSquare className="h-[18px] w-[18px]" />
        </Button>
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
            <DropdownMenuItem onClick={handleHome}>
              <Home className="w-4 h-4 text-muted-foreground" />
              我的主页
            </DropdownMenuItem>
            {(user?.is_admin || user?.is_super_admin) && (
              <DropdownMenuItem onClick={handleAdmin}>
                <Shield className="w-4 h-4 text-muted-foreground" />
                管理后台
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleWritePost}>
              <PenLine className="w-4 h-4 text-muted-foreground" />
              写文章
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSubscriptionDialogOpen(true)}>
              <CreditCard className="w-4 h-4 text-muted-foreground" />
              订阅
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openSettingsDialog}>
              <Settings className="w-4 h-4 text-muted-foreground" />
              设置
            </DropdownMenuItem>
            <DropdownMenuItem onClick={goTrash}>
              <Trash2 className="w-4 h-4 text-muted-foreground" />
              回收站
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
                  openLoginDialog();
          }}
          title="用户"
        >
          <User className="w-[18px] h-[18px]" />
        </Button>
      )}

      <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} onSuccess={handleLoginSuccess} />
      <LLMSettingsDialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen} />
      <Dialog open={subscriptionDialogOpen} onOpenChange={setSubscriptionDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-[480px]">
          <DialogHeader className="border-b border-border/60 px-6 py-5">
            <DialogTitle className="text-body-lg">订阅</DialogTitle>
            <DialogDescription className="text-meta">
              查看订阅权益、本周用量，或使用兑换码激活订阅。
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-5">
            {subscriptionDialogOpen && <SubscriptionPanel />}
          </div>
        </DialogContent>
      </Dialog>
    </nav>
  );
}
