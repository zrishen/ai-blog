import { useState, useEffect } from "react";
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
  Eye,
  EyeOff,
  Trash2,
  Menu,
  MessageSquare,
  Shield,
  CreditCard,
} from "lucide-react";

import { useChat, toggleTheme } from "../stores/chatStore";
import { useAuth } from "../stores/authStore";

import type { LLMProtocol, LLMSettingsUpdate } from "@/api/auth";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
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
import { LoginDialog } from "@/features/auth";
import { SubscriptionPanel } from "@/components/subscription/SubscriptionPanel";
import { ProjectMark } from "@/components/ProjectMark";
import { getLLMSettings, updateLLMSettings } from "@/api/auth";
import { updateSidebarSettings } from "@/api/blog";
import { cn } from "@/lib/utils";
import { navItemVariants } from "@/lib/visualVariants";
import { useWorkspacePrimaryNavigation } from "@/components/useWorkspacePrimaryNavigation";

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
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [llmProtocol, setLlmProtocol] = useState<LLMProtocol>("openai");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [hasSavedApiKey, setHasSavedApiKey] = useState(false);
  const [apiKeyChanged, setApiKeyChanged] = useState(false);
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

  const openSettingsDialog = async () => {
    setSettingsDialogOpen(true);
    setSettingsLoading(true);
    setSettingsSaving(false);
    setSettingsError(null);
    setSettingsSaved(false);
    setLlmApiKey("");
    setHasSavedApiKey(false);
    setApiKeyChanged(false);
    setShowApiKey(false);
    try {
      const data = await getLLMSettings();
      setLlmProtocol(data.protocol);
      setLlmBaseUrl(data.base_url ?? "");
      setHasSavedApiKey(data.has_api_key);
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
      const update: LLMSettingsUpdate = {
        protocol: llmProtocol,
        base_url: llmBaseUrl.trim() || null,
        model: llmModel.trim() || null,
      };
      if (apiKeyChanged) {
        update.api_key = llmApiKey.trim() || null;
      }
      const data = await updateLLMSettings(update);
      setLlmProtocol(data.protocol);
      setLlmBaseUrl(data.base_url ?? "");
      setLlmModel(data.model ?? "");
      setLlmApiKey("");
      setHasSavedApiKey(data.has_api_key);
      setApiKeyChanged(false);
      setShowApiKey(false);
      dispatch({ type: "SET_LLM_SUPPORTS_THINKING", payload: !!data.supports_thinking });
      setSettingsSaved(true);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "保存设置失败");
    } finally {
      setSettingsSaving(false);
    }
  };

  const [sidebarSaving, setSidebarSaving] = useState(false);
  const handleToggleSidebarTags = async (checked: boolean) => {
    dispatch({ type: "SET_LEFTBAR_SHOW_TAGS", payload: checked });
    setSidebarSaving(true);
    try {
      await updateSidebarSettings(checked);
    } catch {
      dispatch({ type: "SET_LEFTBAR_SHOW_TAGS", payload: !checked });
    } finally {
      setSidebarSaving(false);
    }
  };

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
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent className="max-w-[460px] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="text-body-lg">设置</DialogTitle>
            <DialogDescription className="text-meta">
              管理应用配置。当前可配置后端 LLM 调用使用的 API。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-5 py-4">
            <div>
              <h3 className="text-body font-semibold text-foreground">AI API</h3>
              <p className="mt-1 text-meta text-muted-foreground">保存后会用于后端 LLM 调用。</p>
            </div>

            {settingsError && (
              <Alert variant="destructive" className="text-meta">
                {settingsError}
              </Alert>
            )}
            {settingsSaved && (
              <Alert variant="success" className="text-meta">
                设置已保存，下一次 AI 调用会使用新配置。
              </Alert>
            )}

            <label className="block space-y-1.5">
              <span className="text-body font-medium text-foreground">协议</span>
              <Select
                className="text-body"
                value={llmProtocol}
                onChange={(event) => setLlmProtocol(event.target.value as LLMProtocol)}
                disabled={settingsLoading || settingsSaving}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </Select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-body font-medium text-foreground">Base URL</span>
              <Input
                name="llm-base-url"
                type="url"
                autoComplete="url"
                value={llmBaseUrl}
                onChange={(event) => setLlmBaseUrl(event.target.value)}
                placeholder={llmProtocol === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"}
                disabled={settingsLoading || settingsSaving}
              />
            </label>

            <div className="block space-y-1.5">
              <span className="text-body font-medium text-foreground">API Key</span>
              <div className="relative">
                <Input
                  name="llm-api-key"
                  type={showApiKey ? "text" : "password"}
                  autoComplete="new-password"
                  value={llmApiKey}
                  onChange={(event) => {
                    setLlmApiKey(event.target.value);
                    setApiKeyChanged(true);
                  }}
                  placeholder={hasSavedApiKey ? "已保存 API Key；输入可替换" : "输入 API Key"}
                  disabled={settingsLoading || settingsSaving}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => setShowApiKey((value) => !value)}
                  disabled={settingsLoading || settingsSaving}
                  title={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                  aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {hasSavedApiKey && (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-meta text-muted-foreground">
                    {apiKeyChanged && !llmApiKey.trim() ? "保存后将清除已保存的 API Key。" : "API Key 已保存，留空不会修改。"}
                  </p>
                  {!apiKeyChanged && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-meta text-muted-foreground"
                      onClick={() => setApiKeyChanged(true)}
                      disabled={settingsLoading || settingsSaving}
                    >
                      清除
                    </Button>
                  )}
                </div>
              )}
            </div>

            <label className="block space-y-1.5">
              <span className="flex items-center gap-2 text-body font-medium text-foreground">
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
                    ? <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-caption font-medium text-primary">支持思考</span>
                    : <span className="rounded-full bg-muted px-1.5 py-0.5 text-caption font-medium text-muted-foreground">可能不支持深度思考</span>;
                })()}
              </span>
              <Input
                name="llm-model"
                autoComplete="off"
                value={llmModel}
                onChange={(event) => setLlmModel(event.target.value)}
                placeholder={llmProtocol === "anthropic" ? "claude-3-5-sonnet-latest" : "gpt-4o-mini"}
                disabled={settingsLoading || settingsSaving}
              />
            </label>

            <div className="block space-y-2 border-t border-border pt-4">
              <div>
                <h3 className="text-body font-semibold text-foreground">博客左栏</h3>
                <p className="mt-1 text-meta text-muted-foreground">博主主页左侧栏的显示项。</p>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-body font-medium text-foreground">显示标签云</span>
                <Switch
                  checked={state.leftbarShowTags}
                  onClick={() => handleToggleSidebarTags(!state.leftbarShowTags)}
                  disabled={sidebarSaving}
                  aria-label="显示标签云"
                />
              </div>
            </div>
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
