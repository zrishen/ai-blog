import { useEffect, useRef, useState } from "react";
import { Blocks, Wrench } from "lucide-react";

import type { PluginSummary } from "@/api/plugins";

import { listPlugins, setPluginEnabled } from "@/api/plugins";
import { errorMessage } from "@/lib/errors";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { useChatDispatch, useChatState } from "@/stores/chatStore";

export function PluginCenterDialog() {
  const state = useChatState();
  const dispatch = useChatDispatch();
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const updatingIdsRef = useRef(new Set<number>());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPlugins()
      .then((items) => {
        if (!cancelled) setPlugins(items);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause, "读取插件失败"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function togglePlugin(plugin: PluginSummary) {
    if (updatingIdsRef.current.has(plugin.id)) return;

    const previousEnabled = plugin.is_enabled;
    updatingIdsRef.current.add(plugin.id);
    setError(null);
    setPlugins((items) => items.map((item) => (
      item.id === plugin.id ? { ...item, is_enabled: !previousEnabled } : item
    )));

    try {
      const updated = await setPluginEnabled(plugin.id, !previousEnabled);
      setPlugins((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setPlugins((items) => items.map((item) => (
        item.id === plugin.id ? { ...item, is_enabled: previousEnabled } : item
      )));
      setError(errorMessage(cause, "更新插件失败"));
    } finally {
      updatingIdsRef.current.delete(plugin.id);
    }
  }

  return (
    <Dialog
      open={state.pluginCenterOpen}
      onOpenChange={(open) => dispatch({ type: "TOGGLE_PLUGIN_CENTER", payload: open })}
    >
      <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] max-w-5xl overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Blocks className="h-5 w-5 text-primary" />
            插件
          </DialogTitle>
          <DialogDescription>
            开启后，写作助手可以使用这些能力帮你完成任务
          </DialogDescription>
        </DialogHeader>

        {error && <div className="rounded-control border border-destructive/20 bg-destructive/8 px-3 py-2 text-body text-destructive">{error}</div>}

        {loading ? (
          <div className="flex justify-center py-12 text-muted-foreground">
            <Spinner className="h-5 w-5" />
          </div>
        ) : plugins.length === 0 ? (
          <div className="rounded-surface border border-dashed border-border/70 px-5 py-10 text-center text-body text-muted-foreground">
            暂无可用插件。
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {plugins.map((plugin) => {
              return (
                <section key={plugin.id} className="flex min-h-40 flex-col rounded-surface border border-border/70 bg-card p-4 shadow-sm shadow-foreground/5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                      <Wrench className="h-5 w-5" />
                    </div>
                    <Switch
                      checked={plugin.is_enabled}
                      aria-label={`启用 ${plugin.name}`}
                      onClick={() => void togglePlugin(plugin)}
                    />
                  </div>
                  <h3 className="mt-4 font-medium text-foreground">{plugin.name}</h3>
                  <p className="mt-1 line-clamp-3 text-body leading-6 text-muted-foreground">{plugin.description || "可供写作助手调用的扩展能力"}</p>
                </section>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
