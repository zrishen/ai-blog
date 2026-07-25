import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useChat, toggleTheme } from "../stores/chatStore";
import { useAuth } from "../stores/authStore";
import { motion } from "motion/react";
import {
  Sun,
  Moon,
  PenLine,
  User,
  LogOut,
  Home,
  Settings,
  Eye,
  EyeOff,
  Trash2,
  Menu,
  MessageSquare,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { LoginDialog } from "@/features/auth/LoginDialog";
import { SubscriptionPanel } from "@/features/subscription/components/SubscriptionPanel";
import { ProjectMark } from "@/components/ProjectMark";
import { TrashDialog } from "@/features/file/components/TrashDialog";
import type { AuthUser } from "../stores/authStore";
import { getLLMSettings, updateLLMSettings } from "../api/client";
import type { LLMProtocol } from "../api/client";

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
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [trashDialogOpen, setTrashDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [llmProtocol, setLlmProtocol] = useState<LLMProtocol>("openai");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  // 登录后自动获取模型能力信息
  useEffect(() => {
    if (!isAuthenticated) {
      dispatch({ type: "SET_LLM_SUPPORTS_THINKING", payload: true });
      return;
    }
    getLLMSettings()
      .then((data) => dispatch({ type: "SET_LLM_SUPPORTS_THINKING", payload: !!data.supports_thinking }))
      .catch(() => {});
  }, [isAuthenticated, dispatch]);

  const resetBlogList = () => {
    dispatch({ type: "SET_PAGE", payload: "blog" });
    dispatch({ type: "SET_BLOG_VIEW", payload: "list" });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
  };

  const handleLandingHome = () => {
    resetBlogList();
    if (user?.username) {
      navigate(`/u/${encodeURIComponent(user.username)}`);
      return;
    }
    navigate("/");
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
      setLoginDialogOpen(true);
      return;
    }
    dispatch({ type: "SET_PAGE", payload: "blog" });
    dispatch({ type: "SET_BLOG_VIEW", payload: "edit" });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
    navigate(`/u/${encodeURIComponent(user.username)}`);
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

  const openSettingsDialog = async () => {
    setSettingsDialogOpen(true);
    setSettingsLoading(true);
    setSettingsSaving(false);
    setSettingsError(null);
    setSettingsSaved(false);
    setLlmApiKey("");
    setShowApiKey(false);
    try {
      const data = await getLLMSettings();
      setLlmProtocol(data.protocol);
      setLlmBaseUrl(data.base_url ?? "");
      setLlmApiKey(data.api_key ?? "");
      setLlmModel(data.model ?? "");
      dispatch({ type: "SET_LLM_SUPPORTS_THINKING", payload: !!data.supports_thinking });
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "读取设置失败");
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsSaved(false);
    try {
      const data = await updateLLMSettings({
        protocol: llmProtocol,
        base_url: llmBaseUrl.trim() || null,
        api_key: llmApiKey.trim() || null,
        model: llmModel.trim() || null,
      });
      setLlmProtocol(data.protocol);
      setLlmBaseUrl(data.base_url ?? "");
      setLlmModel(data.model ?? "");
      setLlmApiKey(data.api_key ?? "");
      setShowApiKey(false);
      dispatch({ type: "SET_LLM_SUPPORTS_THINKING", payload: !!data.supports_thinking });
      setSettingsSaved(true);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "保存设置失败");
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleLoginSuccess = (loggedInUser: AuthUser) => {
    dispatch({ type: "SET_PAGE", payload: "blog" });
    dispatch({ type: "SET_BLOG_VIEW", payload: "list" });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
    navigate(`/u/${encodeURIComponent(loggedInUser.username)}`);
  };

  return (
    <nav className="h-13 flex-shrink-0 flex items-center bg-card/78 backdrop-blur-xl border-b border-border/80 px-2.5 sm:px-4 gap-1.5 sm:gap-3 z-100 relative shadow-[0_10px_35px_hsl(var(--foreground)/0.05)] select-none">
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
        className="group mr-1 flex min-w-0 cursor-pointer items-center gap-2 border-none bg-transparent sm:mr-3 sm:gap-2.5"
        onClick={handleLandingHome}
      >
        <span className="flex h-8 w-8 -rotate-6 items-center justify-center text-[#1E2A3A] transition-transform group-hover:-rotate-3 group-hover:scale-105 dark:text-foreground">
          <ProjectMark className="h-7 w-7" />
        </span>
        <span
          className="hidden text-left whitespace-nowrap text-[15px] font-semibold tracking-[0.06em] text-foreground transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:scale-[1.03] sm:inline"
          style={{ fontFamily: '"Songti SC", "Noto Serif CJK SC", "STSong", "SimSun", serif' }}
        >
          把想法写成体系
        </span>
      </button>

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
            <DropdownMenuItem onClick={handleMyHome}>
              <Home className="w-4 h-4 text-muted-foreground" />
              我的主页
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleWritePost}>
              <PenLine className="w-4 h-4 text-muted-foreground" />
              写文章
            </DropdownMenuItem>
            {(user?.is_admin || user?.is_super_admin) && (
              <DropdownMenuItem onClick={handleAdmin}>
                <Shield className="w-4 h-4 text-muted-foreground" />
                管理后台
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={openSettingsDialog}>
              <Settings className="w-4 h-4 text-muted-foreground" />
              设置
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTrashDialogOpen(true)}>
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
                  setLoginDialogOpen(true);
          }}
          title="用户"
        >
          <User className="w-[18px] h-[18px]" />
        </Button>
      )}

      <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} onSuccess={handleLoginSuccess} />
      <TrashDialog
        open={trashDialogOpen}
        onOpenChange={setTrashDialogOpen}
        onRestored={() => dispatch({ type: "INCREMENT_TRASH_REVISION" })}
        onPurged={() => dispatch({ type: "INCREMENT_TRASH_REVISION" })}
      />
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent className="max-w-[460px] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="text-[18px]">设置</DialogTitle>
            <DialogDescription className="text-[13px]">
              管理应用配置。当前可配置后端 LLM 调用使用的 API。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-5 py-4">
            <SubscriptionPanel />

            <div>
              <h3 className="text-sm font-semibold text-foreground">AI API</h3>
              <p className="mt-1 text-[13px] text-muted-foreground">保存后会用于后端 LLM 调用。</p>
            </div>

            {settingsError && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-[13px] text-destructive">
                {settingsError}
              </div>
            )}
            {settingsSaved && (
              <div className="rounded-lg border border-emerald-200/70 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">
                设置已保存，下一次 AI 调用会使用新配置。
              </div>
            )}

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground">协议</span>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={llmProtocol}
                onChange={(event) => setLlmProtocol(event.target.value as LLMProtocol)}
                disabled={settingsLoading || settingsSaving}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground">Base URL</span>
              <Input
                value={llmBaseUrl}
                onChange={(event) => setLlmBaseUrl(event.target.value)}
                placeholder={llmProtocol === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"}
                disabled={settingsLoading || settingsSaving}
              />
            </label>

            <div className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground">API Key</span>
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={llmApiKey}
                  onChange={(event) => setLlmApiKey(event.target.value)}
                  placeholder="输入 API Key"
                  disabled={settingsLoading || settingsSaving}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => setShowApiKey((value) => !value)}
                  disabled={settingsLoading || settingsSaving}
                  title={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                  aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <label className="block space-y-1.5">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                Model
                {(() => {
                  const name = llmModel.trim().toLowerCase();
                  const capable = name && (
                    name.includes("deepseek") || name.includes("qwq") || name.includes("o1") ||
                    name.includes("o3") || name.includes("o4") || name.includes("claude") ||
                    name.includes("reasoning") || name.includes("think") || name.includes("qwen3")
                  );
                  if (!name) return null;
                  return capable
                    ? <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">支持思考</span>
                    : <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">可能不支持深度思考</span>;
                })()}
              </span>
              <Input
                value={llmModel}
                onChange={(event) => setLlmModel(event.target.value)}
                placeholder={llmProtocol === "anthropic" ? "claude-3-5-sonnet-latest" : "gpt-4o-mini"}
                disabled={settingsLoading || settingsSaving}
              />
            </label>
          </div>

          <DialogFooter className="border-t border-border px-5 py-4">
            <Button variant="outline" onClick={() => setSettingsDialogOpen(false)} disabled={settingsSaving}>
              取消
            </Button>
            <Button onClick={handleSaveSettings} disabled={settingsLoading || settingsSaving}>
              {settingsSaving ? "保存中..." : "保存设置"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  );
}
