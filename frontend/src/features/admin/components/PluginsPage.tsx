import { useEffect, useState } from "react";
import { Blocks, LoaderCircle, Pencil, Plus, ShieldCheck, Trash2, Wrench } from "lucide-react";
import {
  createAdminPlugin,
  deleteAdminPlugin,
  listAdminPlugins,
  setAdminPluginPublished,
  updateAdminPlugin,
  type AdminPlugin,
  type AdminPluginDraft,
  type PluginPermissionLevel,
  type PluginTransport,
} from "@/api/client";
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
import { Textarea } from "@/components/ui/textarea";
import { AdminPage, AdminPageHeader } from "./AdminPage";

type PluginForm = {
  slug: string;
  name: string;
  description: string;
  transport: PluginTransport;
  command: string;
  args: string;
  envVars: string;
  url: string;
  permissionLevel: PluginPermissionLevel;
  isPublished: boolean;
};

const EMPTY_FORM: PluginForm = {
  slug: "",
  name: "",
  description: "",
  transport: "stdio",
  command: "",
  args: "[]",
  envVars: "",
  url: "",
  permissionLevel: "read",
  isPublished: false,
};

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function parseJson<T>(value: string, label: string, fallback: T): T {
  if (!value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label}必须是合法 JSON`);
  }
}

function formFromPlugin(plugin: AdminPlugin): PluginForm {
  return {
    slug: plugin.slug,
    name: plugin.name,
    description: plugin.description,
    transport: plugin.transport,
    command: plugin.command ?? "",
    args: JSON.stringify(plugin.args, null, 2),
    // 密钥从不回传到浏览器；留空代表编辑时保持原值。
    envVars: "",
    url: plugin.url ?? "",
    permissionLevel: plugin.permission_level,
    isPublished: plugin.is_published,
  };
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
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(plugin: AdminPlugin) {
    setEditing(plugin);
    setForm(formFromPlugin(plugin));
    setFormError(null);
    setFormOpen(true);
  }

  function setField<Key extends keyof PluginForm>(key: Key, value: PluginForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function savePlugin() {
    setSaving(true);
    setFormError(null);
    try {
      const args = parseJson<string[]>(form.args, "参数", []);
      if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
        throw new Error("参数必须是字符串数组");
      }
      const envVars = form.envVars.trim() ? parseJson<Record<string, string>>(form.envVars, "环境变量", {}) : undefined;
      if (envVars && Object.values(envVars).some((value) => typeof value !== "string")) {
        throw new Error("环境变量的值必须是字符串");
      }
      if (!editing) {
        const draft: AdminPluginDraft = {
          slug: form.slug.trim(),
          name: form.name.trim(),
          description: form.description.trim(),
          transport: form.transport,
          command: form.transport === "stdio" ? form.command.trim() : undefined,
          args,
          env_vars: envVars ?? {},
          url: form.transport === "streamable-http" ? form.url.trim() : undefined,
          permission_level: form.permissionLevel,
          is_published: form.isPublished,
        };
        await createAdminPlugin(draft);
      } else {
        await updateAdminPlugin(editing.id, {
          name: form.name.trim(),
          description: form.description.trim(),
          command: editing.transport === "stdio" ? form.command.trim() : undefined,
          args,
          ...(envVars !== undefined ? { env_vars: envVars } : {}),
          url: editing.transport === "streamable-http" ? form.url.trim() : undefined,
          permission_level: form.permissionLevel,
          is_published: form.isPublished,
        });
      }
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

  return (
    <AdminPage>
      <AdminPageHeader
        title="平台插件"
        description="由管理员维护 MCP 运行配置；普通用户只会看到已发布的插件，并自行启用或停用。"
        actions={<Button onClick={openCreate}><Plus />添加插件</Button>}
      />

      {error && <div className="rounded-control border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><LoaderCircle className="h-5 w-5 animate-spin" /></div>
      ) : plugins.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">还没有平台插件。添加后先确认发现到工具，再发布给用户。</CardContent></Card>
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
                    <p className="mt-1 text-sm text-muted-foreground">{plugin.description || "未填写说明"}</p>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Wrench className="h-3.5 w-3.5" />{plugin.tools.length} 个工具</span>
                      <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />{plugin.permission_level === "write" ? "可写入" : "只读"}</span>
                      <span>{plugin.transport}</span>
                      {plugin.has_env_vars && <span>已配置环境变量</span>}
                    </div>
                    <p className="mt-2 truncate text-xs text-muted-foreground">
                      {plugin.tools.length > 0
                        ? `已发现：${plugin.tools.map((tool) => tool.name).join(" · ")}`
                        : "尚未发现工具，暂不能发布给用户"}
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2 border-t border-border/60 pt-4">
                  <Button size="sm" variant="outline" onClick={() => openEdit(plugin)}><Pencil />编辑</Button>
                  <Button size="sm" variant={plugin.is_published ? "outline" : "default"} disabled={changingPublishId === plugin.id} onClick={() => void togglePublished(plugin)}>
                    {changingPublishId === plugin.id && <LoaderCircle className="animate-spin" />}
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
        <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑平台插件" : "添加平台插件"}</DialogTitle>
            <DialogDescription>此处保存的 MCP 命令、URL 和环境变量只由管理员配置，普通用户无法读取或提交。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">插件名称<Input value={form.name} onChange={(event) => setField("name", event.target.value)} /></label>
            <label className="grid gap-1.5 text-sm font-medium">插件标识
              <Input value={form.slug} disabled={Boolean(editing)} placeholder="web-search" onChange={(event) => setField("slug", event.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">说明<Textarea value={form.description} onChange={(event) => setField("description", event.target.value)} /></label>
            <label className="grid gap-1.5 text-sm font-medium">传输方式
              <Select value={form.transport} disabled={Boolean(editing)} onChange={(event) => setField("transport", event.target.value as PluginTransport)}>
                <option value="stdio">stdio（本地命令）</option>
                <option value="streamable-http">streamable HTTP</option>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">权限级别
              <Select value={form.permissionLevel} onChange={(event) => setField("permissionLevel", event.target.value as PluginPermissionLevel)}>
                <option value="read">只读</option>
                <option value="write">可写入外部服务</option>
              </Select>
            </label>
            {form.transport === "stdio" ? (
              <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">启动命令<Input value={form.command} placeholder="npx" onChange={(event) => setField("command", event.target.value)} /></label>
            ) : (
              <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">服务 URL<Input value={form.url} placeholder="https://example.com/mcp" onChange={(event) => setField("url", event.target.value)} /></label>
            )}
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">参数（JSON 字符串数组）<Textarea className="font-mono text-xs" value={form.args} onChange={(event) => setField("args", event.target.value)} /></label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">环境变量（JSON 对象）
              <Textarea className="font-mono text-xs" value={form.envVars} placeholder={editing ? "留空保持原值；填写 {} 清空" : "{\n  \"API_KEY\": \"...\"\n}"} onChange={(event) => setField("envVars", event.target.value)} />
            </label>
            <div className="flex items-center justify-between gap-3 rounded-control border border-border/70 bg-muted/35 px-3 py-2 text-sm sm:col-span-2">
              <span className="font-medium">立即发布给用户（需发现到可用工具）</span>
              <Button
                type="button"
                size="sm"
                variant={form.isPublished ? "default" : "outline"}
                role="switch"
                aria-checked={form.isPublished}
                onClick={() => setField("isPublished", !form.isPublished)}
              >
                {form.isPublished ? "已开启" : "未开启"}
              </Button>
            </div>
          </div>
          {formError && <div className="rounded-control border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive">{formError}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>取消</Button>
            <Button disabled={saving} onClick={() => void savePlugin()}>{saving && <LoaderCircle className="animate-spin" />}{editing ? "保存修改" : "创建插件"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>删除插件？</DialogTitle><DialogDescription>删除“{deleting?.name}”会同时移除所有用户的启用记录，且无法恢复。</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDeleting(null)}>取消</Button><Button variant="destructive" disabled={deletingBusy} onClick={() => void confirmDelete()}>{deletingBusy && <LoaderCircle className="animate-spin" />}删除</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  );
}
