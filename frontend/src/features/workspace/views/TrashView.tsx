import { useCallback, useEffect, useState } from "react";
import { MessageSquare, RotateCcw, Trash2 } from "lucide-react";

import {
  emptyTrash,
  listTrash,
  purgeTrashItem,
  restoreTrashItem,
  type TrashItem,
} from "../../../api/trash";
import { useChat } from "../../../stores/chatStore";

import { LoadingState, SectionCard, WorkspaceView } from "./shared";
import { formatDate } from "./utils";

import { logError } from "@/utils/logger";
import { BlogIcon } from "@/components/icons";
import { getFileIcon } from "@/components/fileIcons";
import { useFileProcessing } from "@/lib/providers/FileProcessingProvider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";


export function TrashView() {
  const { state, dispatch } = useChat();
  const { restoreFile } = useFileProcessing();
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);

  const reload = useCallback(() => {
    return listTrash()
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    void reload().catch(() => {});
  }, [reload]);

  // 文件还原是异步 job（重建向量）：job 完成/失败时 Provider 会 dispatch revision，
  // 据此自动 reload。不在点击还原时立即 reload——那会把 job 未完成的项又拉回列表。
  useEffect(() => {
    if (state.trashRevision === 0) return;
    void reload().catch(() => {});
  }, [state.trashRevision, reload]);

  const handleRestore = useCallback(
    async (it: TrashItem) => {
      const key = `${it.type}-${it.id}`;
      setBusyKey(key);
      // 乐观移除：点击瞬间从列表去掉
      setItems((cur) => (cur ? cur.filter((x) => `${x.type}-${x.id}` !== key) : cur));
      try {
        if (it.type === "file_document") {
          // 文件还原是异步 job（重建向量）：交给 Provider 轮询，job 完成/失败时它会
          // dispatch revision，本视图经 trashRevision 监听自动 reload。避免在此立即 reload
          // 把 job 未完成的项又拉回（即「刷新后又显示」）。
          await restoreFile(it);
        } else {
          // 博客/会话同步还原：接口返回即生效，dispatch 触发本视图及其它栏刷新。
          await restoreTrashItem(it.type, it.id);
          dispatch({ type: "INCREMENT_FILE_RESTORE_REVISIONS" });
        }
      } catch (e) {
        logError(e, { source: "trash.restore" });
        await reload(); // 失败回滚：重新拉取真实列表
      } finally {
        setBusyKey(null);
      }
    },
    [restoreFile, dispatch, reload],
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
        logError(e, { source: "trash.purge" });
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
      logError(e, { source: "trash.empty" });
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
            description="删除的会话、文件、文章、文件夹会暂存在这里，可恢复或永久清除。"
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
                const busy = busyKey === key;
                return (
                  <li key={key} className="group relative">
                    <div className="flex w-full items-center gap-3 rounded-control px-3 py-2 hover:bg-secondary/60">
                      {it.type === "blog_post" ? (
                        <BlogIcon className="h-4 w-4 flex-shrink-0" />
                      ) : it.type === "file_document" ? (
                        getFileIcon(it.name)
                      ) : (
                        <MessageSquare className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
                        {it.name || `#${it.id}`}
                      </span>
                      {/* hover 时淡出，让位给「还原 / 删除」按钮 */}
                      <span className="text-fine text-muted-foreground transition-opacity group-hover:opacity-0">
                        {formatDate(it.deleted_at)}
                      </span>
                    </div>
                    <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        aria-label="还原"
                        onClick={() => handleRestore(it)}
                        disabled={busy}
                        className="flex items-center gap-1 rounded-control bg-card/80 px-1.5 py-1 text-fine text-muted-foreground backdrop-blur-sm transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        还原
                      </button>
                      <button
                        type="button"
                        aria-label="永久删除"
                        onClick={() => handlePurge(it)}
                        disabled={busy}
                        className="flex items-center gap-1 rounded-control bg-card/80 px-1.5 py-1 text-fine text-muted-foreground backdrop-blur-sm transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        )}
    </WorkspaceView>
  );
}
