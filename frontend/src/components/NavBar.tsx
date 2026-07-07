import { useState } from "react";
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
import { ProjectMark } from "@/components/ProjectMark";
import type { AuthUser } from "../stores/authStore";
import { getLLMSettings, updateLLMSettings } from "../api/client";
import type { LLMProtocol } from "../api/client";

export function NavBar() {
  const { state, dispatch } = useChat();
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [llmProtocol, setLlmProtocol] = useState<LLMProtocol>("openai");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [hasSavedApiKey, setHasSavedApiKey] = useState(false);

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

  const openSettingsDialog = async () => {
    setSettingsDialogOpen(true);
    setSettingsLoading(true);
    setSettingsSaving(false);
    setSettingsError(null);
    setSettingsSaved(false);
    setLlmApiKey("");
    try {
      const data = await getLLMSettings();
      setLlmProtocol(data.protocol);
      setLlmBaseUrl(data.base_url ?? "");
      setLlmModel(data.model ?? "");
      setHasSavedApiKey(data.has_api_key);
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
      setHasSavedApiKey(data.has_api_key);
      setLlmApiKey("");
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
    <nav className="h-13 flex-shrink-0 flex items-center bg-card/78 backdrop-blur-xl border-b border-border/80 px-4 gap-3 z-100 relative shadow-[0_10px_35px_hsl(var(--foreground)/0.05)] select-none">
      <button
        className="flex items-center gap-2.5 mr-3 cursor-pointer bg-transparent border-none group"
        onClick={handleLandingHome}
      >
        <span className="flex h-8 w-8 -rotate-6 items-center justify-center text-[#1E2A3A] transition-transform group-hover:-rotate-3 group-hover:scale-105 dark:text-foreground">
          <ProjectMark className="h-7 w-7" />
        </span>
        <span
          className="text-left whitespace-nowrap text-[15px] font-semibold tracking-[0.06em] text-foreground transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:scale-[1.03]"
          style={{ fontFamily: '"Songti SC", "Noto Serif CJK SC", "STSong", "SimSun", serif' }}
        >
          把想法写成体系
        </span>
      </button>

      <div className="flex-1" />


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
            <DropdownMenuItem onClick={openSettingsDialog}>
              <Settings className="w-4 h-4 text-muted-foreground" />
              设置
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
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent className="max-w-[460px] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="text-[18px]">设置</DialogTitle>
            <DialogDescription className="text-[13px]">
              管理应用配置。当前可配置后端 LLM 调用使用的 API。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-5 py-4">
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

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground">API Key</span>
              <Input
                type="password"
                value={llmApiKey}
                onChange={(event) => setLlmApiKey(event.target.value)}
                placeholder={hasSavedApiKey ? "已保存，留空则不修改" : "输入 API Key"}
                disabled={settingsLoading || settingsSaving}
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground">Model</span>
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
