import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Trash2, RotateCcw, Loader2, MessageSquare, FileText, PenLine, Search } from "lucide-react";
import { listTrash, restoreTrashItem, purgeTrashItem, emptyTrash } from "../../../api/trash";
import type { TrashItem, TrashItemType, TrashPurgeResponse } from "../../../api/trash";
import { useFileProcessing } from "../../../features/file-processing/FileProcessingProvider";
import { FileProcessingProgress } from "../../../features/file-processing/FileProcessingProgress";

interface TrashDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored?: () => void;
  onPurged?: () => void;
}

const SEARCH_THRESHOLD = 10;

const TYPE_META: Record<TrashItemType, { label: string; icon: typeof MessageSquare }> = {
  conversation: { label: "会话", icon: MessageSquare },
  file_document: { label: "文件", icon: FileText },
  blog_post: { label: "文章", icon: PenLine },
};

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

export function TrashDialog({ open, onOpenChange, onRestored, onPurged }: TrashDialogProps) {
  const { restoreJobs, restoreFile, consumeRestoreSuccess } = useFileProcessing();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [pendingActions, setPendingActions] = useState<Set<string>>(() => new Set());
  const [purgeTarget, setPurgeTarget] = useState<TrashItem | null>(null);
  const [emptyConfirmOpen, setEmptyConfirmOpen] = useState(false);
  const [partialNotice, setPartialNotice] = useState<string | null>(null);
  const handledRestoreSuccessesRef = useRef(new Set<string>());

  const load = useCallback(async () => {
    setLoading(true);
    setHasLoaded(false);
    setError(null);
    try {
      const data = await listTrash();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setError("回收站加载失败，请稍后重试");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // 异步加载回收站；rule 无法识别 useCallback 内的同步 setState 是异步链入口
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [open, load]);

  // 切换关闭时清理临时状态
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) return;
    setPartialNotice(null);
    setSearchKeyword("");
    setPendingActions(new Set());
    setPurgeTarget(null);
    setEmptyConfirmOpen(false);
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const filteredItems = useMemo(() => {
    if (!searchKeyword.trim()) return items;
    const kw = searchKeyword.trim().toLowerCase();
    return items.filter((it) => it.name?.toLowerCase().includes(kw));
  }, [items, searchKeyword]);

  const showSearch = total > SEARCH_THRESHOLD;
  const emptying = pendingActions.has("empty");
  const purgeTargetPending = purgeTarget
    ? pendingActions.has(`${purgeTarget.type}:${purgeTarget.id}:purge`)
    : false;

  const handleRestore = useCallback(async (item: TrashItem) => {
    const key = `${item.type}:${item.id}:restore`;
    setPendingActions((current) => new Set(current).add(key));
    setError(null);
    try {
      if (item.type === "file_document") {
        await restoreFile(item);
      } else {
        await restoreTrashItem(item.type, item.id);
        setItems((prev) => prev.filter((it) => !(it.type === item.type && it.id === item.id)));
        setTotal((prev) => Math.max(0, prev - 1));
        onRestored?.();
      }
    } catch {
      setError("恢复失败，请稍后重试");
    } finally {
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, [onRestored, restoreFile]);

  useEffect(() => {
    if (!open || !hasLoaded) return;
    const succeeded = Object.entries(restoreJobs)
      .filter(([, job]) => job.status === "succeeded" && !handledRestoreSuccessesRef.current.has(job.id))
      .map(([sourceId, job]) => ({ sourceId: Number(sourceId), jobId: job.id }));
    if (succeeded.length === 0) return;

    const succeededIds = succeeded.map(({ sourceId }) => sourceId);
    succeeded.forEach(({ sourceId, jobId }) => {
      handledRestoreSuccessesRef.current.add(jobId);
      consumeRestoreSuccess(sourceId, jobId);
    });
    setItems((current) => current.filter((item) => item.type !== "file_document" || !succeededIds.includes(item.id)));
    setTotal((current) => Math.max(0, current - succeededIds.length));
  }, [consumeRestoreSuccess, hasLoaded, open, restoreJobs]);

  const handleConfirmPurge = useCallback(async () => {
    const item = purgeTarget;
    if (!item) return;
    const key = `${item.type}:${item.id}:purge`;
    setPendingActions((current) => new Set(current).add(key));
    setError(null);
    try {
      await purgeTrashItem(item.type, item.id);
      setItems((prev) => prev.filter((it) => !(it.type === item.type && it.id === item.id)));
      setTotal((prev) => Math.max(0, prev - 1));
      onPurged?.();
    } catch {
      setError("永久删除失败，请稍后重试");
    } finally {
      setPurgeTarget(null);
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, [onPurged, purgeTarget]);

  const handleEmptyAll = useCallback(async () => {
    setPendingActions((current) => new Set(current).add("empty"));
    setError(null);
    setPartialNotice(null);
    let result: TrashPurgeResponse;
    try {
      result = await emptyTrash();
    } catch {
      setError("清空回收站失败，请稍后重试");
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete("empty");
        return next;
      });
      return;
    }
    if (result.status === "ok") {
      setItems([]);
      setTotal(0);
      setEmptyConfirmOpen(false);
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete("empty");
        return next;
      });
      onPurged?.();
      return;
    }
    // partial：移除成功项，保留失败项
    const failedKeys = new Set(
      (result.failed ?? []).map((f) => `${f.item.type}:${f.item.id}`),
    );
    setItems((prev) => prev.filter((it) => failedKeys.has(`${it.type}:${it.id}`)));
    setTotal(result.remaining ?? failedKeys.size);
    const failedMessages = (result.failed ?? [])
      .map((f) => f.message || `${TYPE_META[f.item.type].label}删除失败`)
      .filter(Boolean);
    setPartialNotice(
      failedMessages.length > 0
        ? `部分项目无法清空：${failedMessages.slice(0, 3).join("；")}${failedMessages.length > 3 ? " 等" : ""}`
        : "部分项目无法清空，请稍后重试",
    );
    setEmptyConfirmOpen(false);
    setPendingActions((current) => {
      const next = new Set(current);
      next.delete("empty");
      return next;
    });
    if ((result.deleted?.length ?? 0) > 0) onPurged?.();
  }, [onPurged]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[680px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-[17px] flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-muted-foreground" />
            回收站
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            已删除的文件、文章和 AI 会话会保留在这里，直到永久删除。
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-3 flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
          {error && (
            <Alert variant="destructive" className="text-[13px]">
              {error}
            </Alert>
          )}
          {partialNotice && !emptyConfirmOpen && !purgeTarget && (
            <Alert variant="warning" className="text-[13px]">
              {partialNotice}
            </Alert>
          )}

          {showSearch && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-8 h-9"
                placeholder="按名称搜索"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
              />
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载中...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {searchKeyword.trim() ? "没有匹配的项目" : "回收站为空"}
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {filteredItems.map((item) => {
                const meta = TYPE_META[item.type] ?? { label: "项目", icon: FileText };
                const Icon = meta.icon;
                const restoreKey = `${item.type}:${item.id}:restore`;
                const purgeKey = `${item.type}:${item.id}:purge`;
                const restoreJob = item.type === "file_document" ? restoreJobs[item.id] : undefined;
                const restoreActive = restoreJob != null && !["succeeded", "failed"].includes(restoreJob.status);
                const restoring = pendingActions.has(restoreKey) || restoreActive;
                const purging = pendingActions.has(purgeKey);
                const rowPending = restoring || purging;
                return (
                  <li key={`${item.type}:${item.id}`} className="group flex items-center gap-3 py-2.5">
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                      <Icon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-foreground">{item.name || "(未命名)"}</div>
                      <div className="text-[12px] text-muted-foreground">
                        {meta.label} · {formatDate(item.deleted_at)}
                      </div>
                      {restoreJob && (
                        <div className="mt-1.5">
                          {restoreJob.status === "failed" ? (
                            <div className="text-[12px] text-destructive">{restoreJob.error_message || "恢复失败，可重试"}</div>
                          ) : (
                            <FileProcessingProgress value={{ percent: restoreJob.progress_percent, stage: restoreJob.current_stage || "正在恢复文件", job: restoreJob }} />
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5"
                        onClick={() => handleRestore(item)}
                        disabled={rowPending || emptying}
                        title="恢复"
                      >
                        {restoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        {restoring ? "恢复中..." : "恢复"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setPurgeTarget(item)}
                        disabled={rowPending || emptying}
                        title="永久删除"
                      >
                        {purging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        永久删除
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="border-t border-border px-5 py-3 flex items-center justify-between gap-2">
          <span className="text-[13px] text-muted-foreground">
            共 {total} 项
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              onClick={() => setEmptyConfirmOpen(true)}
              disabled={total === 0 || emptying}
            >
              <Trash2 className="w-3.5 h-3.5" />
              清空回收站
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </div>
        </DialogFooter>

        <Dialog open={purgeTarget !== null} onOpenChange={(o) => { if (!o && !purgeTargetPending) setPurgeTarget(null); }}>
          <DialogContent className="max-w-[380px] p-0 gap-0">
            <DialogHeader className="border-b border-border px-4 py-3">
              <DialogTitle className="text-[15px]">确认永久删除</DialogTitle>
              <DialogDescription className="text-[13px]">
                永久删除「{purgeTarget?.name}」后无法恢复。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="px-4 py-3 gap-2">
              <Button variant="outline" size="sm" onClick={() => setPurgeTarget(null)} disabled={purgeTargetPending}>
                取消
              </Button>
              <Button size="sm" variant="destructive" onClick={handleConfirmPurge} disabled={purgeTargetPending || emptying}>
                {purgeTargetPending ? "删除中..." : "永久删除"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={emptyConfirmOpen} onOpenChange={(nextOpen) => { if (!emptying) setEmptyConfirmOpen(nextOpen); }}>
          <DialogContent className="max-w-[380px] p-0 gap-0">
            <DialogHeader className="border-b border-border px-4 py-3">
              <DialogTitle className="text-[15px]">确认清空回收站</DialogTitle>
              <DialogDescription className="text-[13px]">
                将永久删除回收站中的全部 {total} 项内容，操作无法撤销。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="px-4 py-3 gap-2">
              <Button variant="outline" size="sm" onClick={() => setEmptyConfirmOpen(false)} disabled={emptying}>
                取消
              </Button>
              <Button size="sm" variant="destructive" onClick={handleEmptyAll} disabled={emptying}>
                {emptying ? "清空中..." : "全部清空"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

export const TRASH_SEARCH_THRESHOLD = SEARCH_THRESHOLD;
