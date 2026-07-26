import { useEffect, useState } from "react";
import { Blocks, Check, LoaderCircle, ShieldCheck, Wrench } from "lucide-react";
import { listPlugins, setPluginEnabled, type PluginSummary } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useChatDispatch, useChatState } from "@/stores/chatStore";

function permissionLabel(permission: PluginSummary["permission_level"]): string {
  return permission === "write" ? "可修改外部内容" : "仅查看信息";
}

export function PluginCenterDialog() {
  const state = useChatState();
  const dispatch = useChatDispatch();
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPlugins()
      .then((items) => {
        if (!cancelled) setPlugins(items);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "读取插件失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function togglePlugin(plugin: PluginSummary) {
    setUpdatingId(plugin.id);
    setError(null);
    try {
      const updated = await setPluginEnabled(plugin.id, !plugin.is_enabled);
      setPlugins((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新插件失败");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <Dialog
      open={state.pluginCenterOpen}
      onOpenChange={(open) => dispatch({ type: "TOGGLE_PLUGIN_CENTER", payload: open })}
    >
      <DialogContent className="max-h-[min(680px,calc(100vh-2rem))] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Blocks className="h-5 w-5 text-primary" />
            插件
          </DialogTitle>
          <DialogDescription>
            开启后，写作助手可以使用这些能力帮你完成任务；你随时可以停用。
          </DialogDescription>
        </DialogHeader>

        {error && <div className="rounded-control border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</div>}

        {loading ? (
          <div className="flex justify-center py-12 text-muted-foreground">
            <LoaderCircle className="h-5 w-5 animate-spin" />
          </div>
        ) : plugins.length === 0 ? (
          <div className="rounded-surface border border-dashed border-border/70 px-5 py-10 text-center text-sm text-muted-foreground">
            暂无可用插件。
          </div>
        ) : (
          <div className="space-y-3">
            {plugins.map((plugin) => {
              const updating = updatingId === plugin.id;
              return (
                <section key={plugin.id} className="rounded-surface border border-border/70 bg-card p-4 shadow-sm shadow-foreground/5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                      <Wrench className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium text-foreground">{plugin.name}</h3>
                        {plugin.is_enabled && <Badge className="gap-1"><Check className="h-3 w-3" />已启用</Badge>}
                      </div>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{plugin.description || "可供写作助手调用的扩展能力。"}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Wrench className="h-3.5 w-3.5" />{plugin.tool_count} 个工具</span>
                        <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />{permissionLabel(plugin.permission_level)}</span>
                      </div>
                    </div>
                    <Button
                      variant={plugin.is_enabled ? "outline" : "default"}
                      size="sm"
                      className="shrink-0"
                      disabled={updating}
                      onClick={() => void togglePlugin(plugin)}
                    >
                      {updating && <LoaderCircle className="animate-spin" />}
                      {plugin.is_enabled ? "停用" : "启用"}
                    </Button>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
