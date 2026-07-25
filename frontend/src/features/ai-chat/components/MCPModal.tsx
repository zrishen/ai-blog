import { useState, useCallback, useEffect } from "react";
import { useChat } from "../../../stores/chatStore";
import { listMCPServers, addMCPServer, toggleMCPServer, deleteMCPServer, type MCPServerConfig } from "../../../api/client";
import { motion, AnimatePresence } from "motion/react";
import { X, Wrench, Globe, Terminal, Trash2, Plus, AlertCircle, ArrowLeft, Eye, Copy, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";

interface MCPServerFormData {
  name: string;
  server_type: "stdio" | "streamable-http";
  command: string;
  args: string;
  env_vars: string;
  url: string;
  jsonConfig: string;
}

function upsertServer(servers: MCPServerConfig[], server: MCPServerConfig) {
  return servers.some((s) => s.id === server.id)
    ? servers.map((s) => (s.id === server.id ? server : s))
    : [...servers, server];
}

export function MCPModal() {
  const { state, dispatch } = useChat();
  const servers = state.mcpServers;
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<MCPServerFormData>({
    name: "", server_type: "stdio", command: "", args: "", env_vars: "", url: "", jsonConfig: "",
  });
  const [wizardView, setWizardView] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewingServer, setViewingServer] = useState<MCPServerConfig | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!state.mcpModalOpen) return;
    listMCPServers()
      .then((data) => { dispatch({ type: "SET_MCP_SERVERS", payload: data.servers }); })
      .catch(() => setError("加载 MCP 服务失败"));
  }, [dispatch, state.mcpModalOpen]);

  const handleToggle = useCallback(async (id: number, isActive: boolean) => {
    try {
      const updated = await toggleMCPServer(id, !isActive);
      dispatch({ type: "SET_MCP_SERVERS", payload: upsertServer(state.mcpServers, updated) });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "切换失败");
    }
  }, [dispatch, state.mcpServers]);

  const handleAdd = useCallback(async () => {
    let name = formData.name.trim();
    let serverType = formData.server_type;
    let command: string | undefined;
    let args: string[] | undefined;
    let envVars: Record<string, string> | undefined;
    let url: string | undefined;

    if (formData.jsonConfig.trim()) {
      try {
        const raw = JSON.parse(formData.jsonConfig.trim());
        let parsed: Record<string, unknown>;
        if (raw.mcpServers && typeof raw.mcpServers === "object") {
          const entries = Object.entries(raw.mcpServers);
          if (entries.length === 0) { setError("mcpServers 为空"); return; }
          const [serverName, serverConfig] = entries[0];
          name = name || serverName;
          parsed = typeof serverConfig === "object" && serverConfig !== null ? serverConfig as Record<string, unknown> : {};
          if (!parsed.type) parsed.type = "stdio";
        } else {
          parsed = raw;
        }

        name = (parsed.name as string) || name;
        serverType = (parsed.type === "streamable-http" ? "streamable-http" : "stdio") as typeof serverType;
        command = parsed.command as string | undefined;
        args = Array.isArray(parsed.args) ? parsed.args : undefined;
        envVars = parsed.env_vars && typeof parsed.env_vars === "object" ? parsed.env_vars as Record<string, string> : undefined;
        url = parsed.url as string | undefined;
      } catch {
        setError("JSON 格式错误，请检查");
        return;
      }
    } else {
      command = formData.server_type === "stdio" ? formData.command.trim() || undefined : undefined;
      args = formData.server_type === "stdio" && formData.args.trim() ? formData.args.trim().split(/\s+/).filter(Boolean) : undefined;
      url = formData.server_type === "streamable-http" ? formData.url.trim() || undefined : undefined;
      if (formData.env_vars.trim()) {
        try { envVars = JSON.parse(formData.env_vars.trim()); } catch { setError("环境变量 JSON 格式错误"); return; }
      }
    }

    if (!name) { setError("名称不能为空"); return; }
    if (serverType === "stdio" && !command) { setError("命令不能为空"); return; }
    if (serverType === "streamable-http" && !url) { setError("URL 不能为空"); return; }

    setSaving(true);
    setError(null);
    try {
      const server = await addMCPServer({
        name,
        server_type: serverType,
        command: serverType === "stdio" ? command : undefined,
        args,
        env_vars: envVars,
        url: serverType === "streamable-http" ? url : undefined,
      });
      dispatch({ type: "SET_MCP_SERVERS", payload: upsertServer(state.mcpServers, server) });
      setShowForm(false);
      setWizardView(false);
      setFormData({ name: "", server_type: "stdio", command: "", args: "", env_vars: "", url: "", jsonConfig: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加失败");
    } finally {
      setSaving(false);
    }
  }, [formData, dispatch, state.mcpServers]);

  const handleDelete = useCallback(async (id: number) => {
    if (!confirm("删除此 MCP 服务？")) return;
    try {
      await deleteMCPServer(id);
      dispatch({ type: "REMOVE_MCP_SERVER", payload: id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }, [dispatch]);

  const handleApplyWizard = useCallback(() => {
    const json: Record<string, unknown> = {};
    if (formData.name.trim()) json.name = formData.name.trim();
    json.type = formData.server_type;
    if (formData.server_type === "stdio") {
      const cmd = formData.command.trim();
      if (cmd) json.command = cmd;
      const argsStr = formData.args.trim();
      if (argsStr) json.args = argsStr.split(/\n/).map((s) => s.trim()).filter(Boolean);
      if (formData.env_vars.trim()) {
        const envObj: Record<string, string> = {};
        for (const line of formData.env_vars.trim().split(/\n/)) {
          const eqIdx = line.indexOf("=");
          if (eqIdx > 0) {
            envObj[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
          }
        }
        if (Object.keys(envObj).length > 0) json.env_vars = envObj;
      }
    } else {
      const u = formData.url.trim();
      if (u) json.url = u;
    }
    setFormData((prev) => ({ ...prev, jsonConfig: JSON.stringify(json, null, 2) }));
    setWizardView(false);
  }, [formData]);

  const serverTypeIcon = (type: string) => {
    switch (type) {
      case "builtin": return <Wrench className="w-3.5 h-3.5 text-indigo-500" />;
      case "stdio": return <Terminal className="w-3.5 h-3.5 text-green-500" />;
      case "streamable-http": return <Globe className="w-3.5 h-3.5 text-amber-500" />;
      default: return <Wrench className="w-3.5 h-3.5 text-muted-foreground" />;
    }
  };

  const handleCopy = useCallback(() => {
    if (!viewingServer) return;
    const obj: Record<string, unknown> = { name: viewingServer.name, type: viewingServer.server_type };
    if (viewingServer.command) obj.command = viewingServer.command;
    if (viewingServer.args?.length) obj.args = viewingServer.args;
    if (viewingServer.env_vars && Object.keys(viewingServer.env_vars).length) obj.env_vars = viewingServer.env_vars;
    if (viewingServer.url) obj.url = viewingServer.url;
    if (viewingServer.tools_detail?.length) obj.tools = viewingServer.tools_detail;
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [viewingServer]);

  const serverJsonText = (() => {
    if (!viewingServer) return "";
    const obj: Record<string, unknown> = { name: viewingServer.name, type: viewingServer.server_type };
    if (viewingServer.command) obj.command = viewingServer.command;
    if (viewingServer.args?.length) obj.args = viewingServer.args;
    if (viewingServer.env_vars && Object.keys(viewingServer.env_vars).length) obj.env_vars = viewingServer.env_vars;
    if (viewingServer.url) obj.url = viewingServer.url;
    if (viewingServer.tools_detail?.length) obj.tools = viewingServer.tools_detail;
    return JSON.stringify(obj, null, 2);
  })();

  if (viewingServer) {
    return (
      <Dialog open={!!viewingServer} onOpenChange={(open) => !open && setViewingServer(null)}>
        <DialogContent className="max-w-[600px] max-h-[70vh] p-0 gap-0">
          <DialogHeader className="px-5 py-4 border-b border-border flex-row items-center justify-between space-y-0">
            <DialogTitle>MCP 配置 — {viewingServer.name}</DialogTitle>
            <Button variant="ghost" size="sm" className="gap-1.5 text-[13px]" onClick={handleCopy}>
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "已复制" : "复制"}
            </Button>
          </DialogHeader>
          <ScrollArea className="max-h-[calc(70vh-60px)]">
            <pre className="p-5 text-[13px] font-mono leading-relaxed text-foreground whitespace-pre-wrap break-all">
              {serverJsonText}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={state.mcpModalOpen} onOpenChange={(open) => dispatch({ type: "TOGGLE_MCP_MODAL", payload: open })}>
      <DialogContent className="max-w-[700px] max-h-[80vh] p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle>MCP 服务配置</DialogTitle>
        </DialogHeader>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mx-4 mt-2 overflow-hidden"
            >
              <Alert variant="destructive" className="flex items-center gap-2 py-2 text-[13px]">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{error}</span>
              </Alert>
              <Button variant="ghost" size="icon" className="w-5 h-5 text-destructive" onClick={() => setError(null)}>
                <X className="w-4 h-4" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Body */}
        <ScrollArea className="flex-1 max-h-[calc(80vh-120px)]">
          <div className="p-5">
            {/* Installed Services */}
            <div className="mb-5">
              <div className="flex justify-between items-center text-sm font-semibold text-muted-foreground mb-2 pb-1.5 border-b border-border">
                <span>已安装服务</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {servers.length === 0 ? (
                  <div className="text-muted-foreground text-sm py-3">暂无已安装的服务。从下方服务库导入或添加自定义服务。</div>
                ) : (
                  servers.map((server: MCPServerConfig) => (
                    <motion.div
                      key={server.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex justify-between items-center py-2 px-3 bg-card border border-border rounded-xl"
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
                          {serverTypeIcon(server.server_type)}
                          {server.name}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <span className="text-[11px] py-px px-1.5 rounded bg-secondary text-green-500">{server.server_type}</span>
                          {server.command && ` · ${server.command}`}
                          {server.url && ` · ${server.url}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-muted-foreground hover:text-foreground"
                          onClick={() => setViewingServer(server)}
                          title="查看配置"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <button
                          className={`relative w-[34px] h-5 rounded-full cursor-pointer transition-colors duration-200 border-none p-0 ${server.is_active ? "bg-primary" : "bg-border"}`}
                          onClick={() => handleToggle(server.id, server.is_active)}
                          title={server.is_active ? "禁用" : "启用"}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${server.is_active ? "translate-x-[14px]" : ""}`} />
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(server.id)}
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </div>

            {/* Add Custom */}
            <div>
              <div className="flex justify-between items-center text-sm font-semibold text-muted-foreground mb-2 pb-1.5 border-b border-border">
                <span>添加自定义 MCP 服务</span>
                <Button
                  size="sm"
                  className="gap-1 text-[13px]"
                  onClick={() => setShowForm(!showForm)}
                  disabled={saving}
                >
                  {showForm ? "收起" : saving ? "保存中..." : (
                    <span className="flex items-center gap-1"><Plus className="w-3 h-3" /> 添加</span>
                  )}
                </Button>
              </div>

              <AnimatePresence mode="wait">
                {!wizardView ? (
                  /* 主视图：JSON 编辑 */
                  <motion.div
                    key="json-view"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    {showForm && (
                      <div className="flex flex-col gap-3 pt-1">
                        {/* 服务名称 */}
                        <div className="flex flex-col gap-1.5">
                          <label className="text-sm text-muted-foreground">服务名称</label>
                          <Input
                            placeholder="mcp-server"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          />
                        </div>

                        {/* JSON 区域 */}
                        <div className="flex flex-col gap-1.5">
                          {/* JSON 标题栏 */}
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">JSON 配置</span>
                            <button
                              className="text-sm text-primary hover:text-primary/80 cursor-pointer bg-transparent border-none p-0"
                              onClick={() => setWizardView(true)}
                            >
                              配置导向
                            </button>
                          </div>

                          {/* JSON 配置 */}
                          <Textarea
                            className="min-h-[200px] resize-y font-mono leading-relaxed"
                            placeholder={`{
  "type": "stdio",
  "command": "uvx",
  "args": [
    "mcp-server-fetch"
  ]
}`}
                            value={formData.jsonConfig}
                            onChange={(e) => setFormData({ ...formData, jsonConfig: e.target.value })}
                          />
                        </div>

                        <div className="flex gap-2 pt-0.5">
                          <Button onClick={handleAdd} disabled={saving}>
                            保存
                          </Button>
                          <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>
                            取消
                          </Button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  /* 向导视图 */
                  <motion.div
                    key="wizard-view"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden pt-1"
                  >
                    {/* 向导头部 */}
                    <div className="flex items-center gap-2 mb-3">
                      <button
                        className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none p-0"
                        onClick={() => setWizardView(false)}
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        返回
                      </button>
                      <span className="text-sm font-semibold text-foreground">配置导向</span>
                    </div>

                    <p className="text-[13px] text-muted-foreground mb-4">快速配置 MCP 服务器，自动生成 JSON 配置</p>

                    <div className="flex flex-col gap-3">
                      {/* 类型选择 */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm text-muted-foreground">类型</label>
                        <div className="flex gap-2">
                          {(["stdio", "streamable-http"] as const).map((t) => (
                            <Button
                              type="button"
                              size="sm"
                              variant={formData.server_type === t ? "default" : "outline"}
                              key={t}
                              onClick={() => setFormData({ ...formData, server_type: t })}
                            >
                              {t === "stdio" ? "stdio" : "http"}
                            </Button>
                          ))}
                        </div>
                      </div>

                      {/* MCP 标题 */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm text-muted-foreground">MCP 标题</label>
                        <Input
                          placeholder="mcp-server-fetch"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        />
                      </div>

                      {/* 命令 — 仅 stdio */}
                      {formData.server_type === "stdio" && (
                        <>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-sm text-muted-foreground">命令</label>
                            <Input
                              placeholder="npx / uvx"
                              value={formData.command}
                              onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                            />
                          </div>

                          {/* 参数 */}
                          <div className="flex flex-col gap-1.5">
                            <label className="text-sm text-muted-foreground">参数</label>
                          <Textarea
                            className="min-h-[70px] resize-y leading-relaxed"
                              placeholder={"arg1\narg2"}
                              value={formData.args}
                              onChange={(e) => setFormData({ ...formData, args: e.target.value })}
                            />
                          </div>

                          {/* 环境变量 */}
                          <div className="flex flex-col gap-1.5">
                            <label className="text-sm text-muted-foreground">环境变量</label>
                          <Textarea
                            className="min-h-[70px] resize-y leading-relaxed"
                              placeholder={"KEY1=value1\nKEY2=value2"}
                              value={formData.env_vars}
                              onChange={(e) => setFormData({ ...formData, env_vars: e.target.value })}
                            />
                          </div>
                        </>
                      )}

                      {/* URL — 仅 streamable-http */}
                      {formData.server_type === "streamable-http" && (
                        <div className="flex flex-col gap-1.5">
                          <label className="text-sm text-muted-foreground">URL</label>
                          <Input
                            placeholder=""
                            value={formData.url}
                            onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                          />
                        </div>
                      )}

                      {/* 按钮 */}
                      <div className="flex gap-2 pt-1">
                        <Button variant="outline" onClick={() => setWizardView(false)} disabled={saving}>
                          取消
                        </Button>
                        <Button onClick={handleApplyWizard} disabled={saving}>
                          应用配置
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
