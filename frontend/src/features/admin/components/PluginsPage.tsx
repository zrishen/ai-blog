import { useEffect, useState } from "react";
import { Blocks, Pencil, Plus, ShieldCheck, Trash2, Wrench } from "lucide-react";
import {
  createAdminPlugin,
  deleteAdminPlugin,
  listAdminPlugins,
  setAdminPluginPublished,
  updateAdminPlugin,
} from "@/api/plugins";
import type {
  AdminPlugin,
  PluginPermissionLevel,
  PluginTransport,
} from "@/api/plugins";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { AdminPage, AdminPageHeader } from "./AdminPage";
import { parseMcpJsonPluginDrafts } from "../pluginMcpImport";

type PluginForm = {
  slug: string;
  name: string;
  description: string;
  permissionLevel: PluginPermissionLevel;
  isPublished: boolean;
};

type McpGuideForm = {
  transport: PluginTransport;
  name: string;
  command: string;
  url: string;
  args: string;
  envVars: string;
};

const EMPTY_FORM: PluginForm = {
  slug: "",
  name: "",
  description: "",
  permissionLevel: "read",
  isPublished: false,
};

const EMPTY_MCP_GUIDE: McpGuideForm = {
  transport: "stdio",
  name: "",
  command: "",
  url: "",
  args: "",
  envVars: "",
};

function parseLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseEnvLines(value: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of parseLines(value)) {
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("环境变量请按 KEY=value 每行填写");
    const key = line.slice(0, separator).trim();
    const envValue = line.slice(separator + 1).trim();
    if (!key) throw new Error("环境变量名称不能为空");
    env[key] = envValue;
  }
  return env;
}

function formFromPlugin(plugin: AdminPlugin): PluginForm {
  return {
    slug: plugin.slug,
    name: plugin.name,
    description: plugin.description,
    permissionLevel: plugin.permission_level,
    isPublished: plugin.is_published,
  };
}

function mcpJsonFromPlugin(plugin: AdminPlugin): string {
  const config: Record<string, unknown> = plugin.transport === "stdio"
    ? { type: "stdio", command: plugin.command ?? "", args: plugin.args }
    : { type: "streamable-http", url: plugin.url ?? "" };
  return JSON.stringify({ mcpServers: { [plugin.slug]: config } }, null, 2);
}

export function PluginsPage() {
  const [plugins, setPlugins] = useState<AdminPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPlugin | null>(null);
  const [form, setForm] = useState<PluginForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminPlugin | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [changingPublishId, setChangingPublishId] = useState<number | null>(null);
  const [mcpJson, setMcpJson] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [guide, setGuide] = useState<McpGuideForm>(EMPTY_MCP_GUIDE);
  const [guideError, setGuideError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setPlugins(await listAdminPlugins());
    } catch (cause) {
      setError(errorMessage(cause, "读取平台插件失败"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    listAdminPlugins()
      .then((items) => {
        if (!cancelled) setPlugins(items);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause, "读取平台插件失败"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setMcpJson("");
    setFormError(null);
    setFormOpen(true);
  }

  function openGuide() {
    setGuide(EMPTY_MCP_GUIDE);
    setGuideError(null);
    setFormOpen(false);
    setGuideOpen(true);
  }

  function closeGuide() {
    setGuideOpen(false);
    setFormOpen(true);
  }

  function openEdit(plugin: AdminPlugin) {
    setEditing(plugin);
    setForm(formFromPlugin(plugin));
    setMcpJson(mcpJsonFromPlugin(plugin));
    setFormError(null);
    setFormOpen(true);
  }

  function setField<Key extends keyof PluginForm>(key: Key, value: PluginForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function syncPluginSlugFromMcpJson(value: string) {
    if (editing) return;
    try {
      const raw: unknown = JSON.parse(value);
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("mcpServers" in raw)) return;
      const configs = parseMcpJsonPluginDrafts(value);
      if (configs.length === 1) setField("slug", configs[0].draft.slug);
    } catch {
      // JSON 尚未输入完整时不打断编辑；保存时再统一校验。
    }
  }

  function updateMcpJson(value: string) {
    setMcpJson(value);
    syncPluginSlugFromMcpJson(value);
  }

  async function savePlugin() {
    setSaving(true);
    setFormError(null);
    try {
      const parsedConfigs = parseMcpJsonPluginDrafts(mcpJson);
      if (parsedConfigs.length !== 1) {
        throw new Error("一次只能保存一个插件，请只保留一个 MCP 配置");
      }
      const [{ draft, includesEnvironmentVariables }] = parsedConfigs;

      if (!editing) {
        await createAdminPlugin({
          ...draft,
          name: form.name.trim(),
          description: form.description.trim(),
          permission_level: form.permissionLevel,
          is_published: form.isPublished,
        });
        setFormOpen(false);
        await reload();
        return;
      }

      if (draft.transport !== editing.transport) {
        throw new Error("编辑时暂不支持更改 MCP 传输方式");
      }
      await updateAdminPlugin(editing.id, {
        name: form.name.trim(),
        description: form.description.trim(),
        command: draft.transport === "stdio" ? draft.command : undefined,
        args: draft.args,
        ...(includesEnvironmentVariables ? { env_vars: draft.env_vars } : {}),
        url: draft.transport === "streamable-http" ? draft.url : undefined,
        permission_level: form.permissionLevel,
        is_published: form.isPublished,
      });
      setFormOpen(false);
      await reload();
    } catch (cause) {
      setFormError(errorMessage(cause, "保存插件失败"));
    } finally {
      setSaving(false);
    }
  }

  async function togglePublished(plugin: AdminPlugin) {
    setChangingPublishId(plugin.id);
    setError(null);
    try {
      const updated = await setAdminPluginPublished(plugin.id, !plugin.is_published);
      setPlugins((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError(errorMessage(cause, "更新发布状态失败"));
    } finally {
      setChangingPublishId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await deleteAdminPlugin(deleting.id);
      setPlugins((items) => items.filter((item) => item.id !== deleting.id));
      setDeleting(null);
    } catch (cause) {
      setError(errorMessage(cause, "删除插件失败"));
      setDeleting(null);
    } finally {
      setDeletingBusy(false);
    }
  }

  function formatMcpJson() {
    try {
      updateMcpJson(JSON.stringify(JSON.parse(mcpJson), null, 2));
      setFormError(null);
    } catch {
      setFormError("JSON 格式错误，无法格式化");
    }
  }

  function applyGuideConfig() {
    const name = guide.name.trim();
    if (!name) {
      setGuideError("请填写 MCP 标题");
      return;
    }
    if (guide.transport === "stdio" && !guide.command.trim()) {
      setGuideError("请填写启动命令");
      return;
    }
    if (guide.transport === "streamable-http" && !guide.url.trim()) {
      setGuideError("请填写服务 URL");
      return;
    }
    try {
      const config: Record<string, unknown> = guide.transport === "stdio"
        ? { type: "stdio", command: guide.command.trim() }
        : { type: "streamable-http", url: guide.url.trim() };
      const args = parseLines(guide.args);
      const env = parseEnvLines(guide.envVars);
      if (args.length) config.args = args;
      if (Object.keys(env).length) config.env = env;
      updateMcpJson(JSON.stringify({ mcpServers: { [name]: config } }, null, 2));
      setFormError(null);
      setGuideOpen(false);
      setFormOpen(true);
    } catch (cause) {
      setGuideError(errorMessage(cause, "生成配置失败"));
    }
  }

  return (
    <AdminPage>
      <AdminPageHeader
        title="平台插件"
        description="由管理员维护 MCP 运行配置；普通用户只会看到已发布的插件，并自行启用或停用。"
        actions={<Button onClick={openCreate}><Plus />添加插件</Button>}
      />

      {error && <div className="rounded-control border border-destructive/20 bg-destructive/8 px-3 py-2 text-body text-destructive">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Spinner className="h-5 w-5" /></div>
      ) : plugins.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-body text-muted-foreground">还没有平台插件。添加后先确认发现到工具，再发布给用户。</CardContent></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {plugins.map((plugin) => (
            <Card key={plugin.id} className="overflow-hidden">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary"><Blocks className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{plugin.name}</h2>
                      <Badge variant={plugin.is_published ? "default" : "secondary"}>{plugin.is_published ? "已发布" : "未发布"}</Badge>
                    </div>
                    <p className="mt-1 text-body text-muted-foreground">{plugin.description || "未填写说明"}</p>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-fine text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Wrench className="h-3.5 w-3.5" />{plugin.tools.length} 个工具</span>
                      <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />{plugin.permission_level === "write" ? "可写入" : "只读"}</span>
                      <span>{plugin.transport}</span>
                      {plugin.has_env_vars && <span>已配置环境变量</span>}
                    </div>
                    <p className="mt-2 truncate text-fine text-muted-foreground">
                      {plugin.tools.length > 0
                        ? `已发现：${plugin.tools.map((tool) => tool.name).join(" · ")}`
                        : "尚未发现工具，暂不能发布给用户"}
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2 border-t border-border/60 pt-4">
                  <Button size="sm" variant="outline" onClick={() => openEdit(plugin)}><Pencil />编辑</Button>
                  <Button size="sm" variant={plugin.is_published ? "outline" : "default"} disabled={changingPublishId === plugin.id} onClick={() => void togglePublished(plugin)}>
                    {changingPublishId === plugin.id && <Spinner />}
                    {plugin.is_published ? "取消发布" : "发布给用户"}
                  </Button>
                  <Button size="sm" variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={() => setDeleting(plugin)}><Trash2 />删除</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[min(820px,calc(100vh-2rem))] max-w-3xl overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑平台插件" : "添加平台插件"}</DialogTitle>
            <DialogDescription>填写插件信息后，可直接粘贴完整 MCP JSON，或通过配置向导生成并回填配置</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-body font-medium">插件名称<Input value={form.name} placeholder="例如：必应搜索" onChange={(event) => setField("name", event.target.value)} /></label>
            <label className="grid gap-1.5 text-body font-medium">插件标识<Input value={form.slug} readOnly placeholder="由 JSON 中的 MCP 服务名自动生成" /></label>
            <label className="grid gap-1.5 text-body font-medium sm:col-span-2">说明<Textarea value={form.description} placeholder="说明这个插件能帮写作助手做什么" onChange={(event) => setField("description", event.target.value)} /></label>
            <label className="grid gap-1.5 text-body font-medium">权限级别
              <Select value={form.permissionLevel} onChange={(event) => setField("permissionLevel", event.target.value as PluginPermissionLevel)}>
                <option value="read">只读</option>
                <option value="write">可写入外部服务</option>
              </Select>
            </label>
            <div className="flex h-9 items-center justify-between gap-3 self-end rounded-control border border-border/70 bg-muted/35 px-3 text-body">
              <span className="font-medium">立即发布给用户</span>
              <Switch
                checked={form.isPublished}
                aria-label="立即发布给用户"
                onClick={() => setField("isPublished", !form.isPublished)}
              />
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-body font-medium">完整的 JSON 配置</span>
              <Button type="button" variant="link" className="h-auto p-0 text-primary" onClick={openGuide}>配置向导</Button>
            </div>
            <Textarea
              className="min-h-64 font-mono text-fine leading-6"
              value={mcpJson}
              placeholder={'{\n  "mcpServers": {\n    "bing-search": {\n      "command": "npx",\n      "args": ["-y", "bing-cn-mcp"]\n    }\n  }\n}'}
              onChange={(event) => updateMcpJson(event.target.value)}
            />
            <Button type="button" variant="ghost" className="-ml-2" onClick={formatMcpJson}>格式化</Button>
          </div>
          {formError && <div className="rounded-control border border-destructive/20 bg-destructive/8 px-3 py-2 text-body text-destructive">{formError}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>取消</Button>
            <Button disabled={saving || !mcpJson.trim()} onClick={() => void savePlugin()}>{saving && <Spinner />}{editing ? "保存修改" : "创建插件"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={guideOpen} onOpenChange={(open) => open ? setGuideOpen(true) : closeGuide()}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>MCP 配置向导</DialogTitle>
            <DialogDescription>快速生成 JSON 配置，应用后会回填到完整配置中。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <span className="text-body font-medium">类型</span>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={guide.transport === "stdio" ? "default" : "outline"}
                  role="radio"
                  aria-checked={guide.transport === "stdio"}
                  onClick={() => setGuide((current) => ({ ...current, transport: "stdio" }))}
                >
                  stdio
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={guide.transport === "streamable-http" ? "default" : "outline"}
                  role="radio"
                  aria-checked={guide.transport === "streamable-http"}
                  onClick={() => setGuide((current) => ({ ...current, transport: "streamable-http" }))}
                >
                  HTTP
                </Button>
              </div>
            </div>
            <label className="grid gap-1.5 text-body font-medium">
              MCP 标题（唯一）
              <Input value={guide.name} placeholder="my-mcp-server" onChange={(event) => setGuide((current) => ({ ...current, name: event.target.value }))} />
            </label>
            {guide.transport === "stdio" ? (
              <label className="grid gap-1.5 text-body font-medium">
                命令
                <Input value={guide.command} placeholder="npx 或 uvx" onChange={(event) => setGuide((current) => ({ ...current, command: event.target.value }))} />
              </label>
            ) : (
              <label className="grid gap-1.5 text-body font-medium">
                服务 URL
                <Input value={guide.url} placeholder="https://example.com/mcp" onChange={(event) => setGuide((current) => ({ ...current, url: event.target.value }))} />
              </label>
            )}
            <label className="grid gap-1.5 text-body font-medium">
              参数
              <Textarea className="min-h-20 font-mono text-fine" value={guide.args} placeholder={'每行一个参数\n-y\nbing-cn-mcp'} onChange={(event) => setGuide((current) => ({ ...current, args: event.target.value }))} />
            </label>
            <label className="grid gap-1.5 text-body font-medium">
              环境变量
              <Textarea className="min-h-20 font-mono text-fine" value={guide.envVars} placeholder={'每行一个变量\nKEY1=value1\nKEY2=value2'} onChange={(event) => setGuide((current) => ({ ...current, envVars: event.target.value }))} />
            </label>
          </div>
          {guideError && <div className="rounded-control border border-destructive/20 bg-destructive/8 px-3 py-2 text-body text-destructive">{guideError}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={closeGuide}>取消</Button>
            <Button onClick={applyGuideConfig}>应用配置</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>删除插件？</DialogTitle><DialogDescription>删除“{deleting?.name}”会同时移除所有用户的启用记录，且无法恢复。</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDeleting(null)}>取消</Button><Button variant="destructive" disabled={deletingBusy} onClick={() => void confirmDelete()}>{deletingBusy && <Spinner />}删除</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  );
}
