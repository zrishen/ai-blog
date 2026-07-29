import { useCallback, useEffect, useState, type ComponentType } from "react";
import { FileStack, FileText, MessageSquare, RotateCcw, Trash2 } from "lucide-react";
import {
  emptyTrash,
  listTrash,
  purgeTrashItem,
  restoreTrashItem,
  type TrashItem,
  type TrashItemType,
} from "../../../api/trash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState, SectionCard, WorkspaceView } from "./shared";
import { formatDate } from "./utils";

const TYPE_META: Record<TrashItemType, { label: string; icon: ComponentType<{ className?: string }> }> = {
  conversation: { label: "会话", icon: MessageSquare },
  file_document: { label: "文件", icon: FileStack },
  blog_post: { label: "文章", icon: FileText },
};

export function TrashView() {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);

  const reload = useCallback(() => {
    return listTrash()
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleRestore = useCallback(
    async (it: TrashItem) => {
      const key = `${it.type}-${it.id}`;
      setBusyKey(key);
      try {
        await restoreTrashItem(it.type, it.id);
        await reload();
      } catch (e) {
        console.error("[workspace] 恢复失败:", e);
      } finally {
        setBusyKey(null);
      }
    },
    [reload],
  );

  const handlePurge = useCallback(
    async (it: TrashItem) => {
      if (!window.confirm(`永久删除「${it.name || `#${it.id}`}」？此操作不可恢复。`)) return;
      const key = `${it.type}-${it.id}`;
      setBusyKey(key);
      try {
        await purgeTrashItem(it.type, it.id);
        await reload();
      } catch (e) {
        console.error("[workspace] 永久删除失败:", e);
      } finally {
        setBusyKey(null);
      }
    },
    [reload],
  );

  const handleEmpty = useCallback(async () => {
    if (!window.confirm(`清空回收站？将永久删除全部 ${items?.length ?? 0} 项，不可恢复。`)) return;
    setEmptying(true);
    try {
      await emptyTrash();
      await reload();
    } catch (e) {
      console.error("[workspace] 清空失败:", e);
    } finally {
      setEmptying(false);
    }
  }, [items?.length, reload]);

  return (
    <WorkspaceView>
      {items === null ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Trash2}
            title="回收站是空的"
            description="删除的会话、文件、文章会暂存在这里，可恢复或永久清除。"
            className="flex-1 p-10"
          />
        ) : (
          <SectionCard
            title={`回收站 · ${items.length}`}
            icon={Trash2}
            actions={
              <Button size="sm" variant="ghost" onClick={handleEmpty} disabled={emptying}>
                <Trash2 className="h-3.5 w-3.5" />
                {emptying ? "清空中…" : "清空"}
              </Button>
            }
          >
            <ul className="flex flex-col">
              {items.map((it) => {
                const key = `${it.type}-${it.id}`;
                const meta = TYPE_META[it.type];
                const Icon = meta.icon;
                const busy = busyKey === key;
                return (
                  <li
                    key={key}
                    className="group flex items-center gap-3 rounded-control px-3 py-2 hover:bg-secondary/60"
                  >
                    <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body font-medium text-foreground">
                        {it.name || `#${it.id}`}
                      </div>
                      <div className="text-fine text-muted-foreground">{formatDate(it.deleted_at)}</div>
                    </div>
                    <Badge variant="secondary">{meta.label}</Badge>
                    <button
                      type="button"
                      aria-label="恢复"
                      onClick={() => handleRestore(it)}
                      disabled={busy}
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="永久删除"
                      onClick={() => handlePurge(it)}
                      disabled={busy}
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        )}
    </WorkspaceView>
  );
}
