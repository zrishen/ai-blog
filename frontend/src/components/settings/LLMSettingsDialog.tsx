import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { useChat } from "@/stores/chatStore";
import { getLLMSettings, updateLLMSettings, updateSidebarSettings, type LLMProtocol, type LLMSettingsUpdate } from "@/api/auth";
import { errorMessage } from "@/lib/errors";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export function LLMSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { state, dispatch } = useChat();
  const [llmProtocol, setLlmProtocol] = useState<LLMProtocol>("openai");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [hasSavedApiKey, setHasSavedApiKey] = useState(false);
  const [apiKeyChanged, setApiKeyChanged] = useState(false);
  const [llmModel, setLlmModel] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [sidebarSaving, setSidebarSaving] = useState(false);

  const openSettingsDialog = async () => {
    setSettingsLoading(true);
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
      setSettingsError(errorMessage(err, "读取设置失败"));
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
      setSettingsError(errorMessage(err, "保存设置失败"));
    } finally {
      setSettingsSaving(false);
    }
  };

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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) void openSettingsDialog();
      }}
    >
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={settingsSaving}>
            取消
          </Button>
          <Button onClick={handleSaveSettings} disabled={settingsLoading || settingsSaving}>
            {settingsSaving ? "保存中..." : "保存设置"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
