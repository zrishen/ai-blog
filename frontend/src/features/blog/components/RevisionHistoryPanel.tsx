import { createPortal } from "react-dom";

import type { RevisionHistoryApi, SaveTarget } from "../hooks/useRevisionHistoryPanel";
import type { BlogRevision, BlogRevisionSummary } from "@/api/blog";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";


const REVISION_KIND_LABELS = {
  commit: "保存版本",
  publish: "发布版本",
  pre_restore: "恢复前备份",
} as const;

function formatRevisionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export interface RevisionHistoryPanelProps {
  open: boolean;
  postId: number | undefined;
  historyPanelPosition: { top: number; left: number };
  title: string;
  saving: boolean;
  revisionBusy: boolean;
  checkingRevisionLimit: boolean;
  revisionHistory: RevisionHistoryApi;
  selectedRevisionId: number | null;
  expandedRevision: BlogRevision | null;
  setExpandedRevision: (revision: BlogRevision | null) => void;
  pendingRestoreRevision: BlogRevision | null;
  restorePruneCandidate: BlogRevisionSummary | null;
  restoreCannotSnapshot: boolean;
  pruneCandidate: BlogRevisionSummary | null;
  pendingSaveTarget: SaveTarget | null;
  previewRevision: (revisionId: number) => void;
  selectDefaultRevision: (revisionId: number) => void;
  restoreDefaultPreview: () => void;
  openExpandedRevision: () => void;
  deleteSelectedRevision: () => void;
  requestRestore: (revision: BlogRevision) => void;
  restoreRevision: (revisionId: number) => void;
  saveAndRestore: (revision: BlogRevision) => void;
  cancelRestore: () => void;
  cancelPrune: () => void;
  onSave: (target: SaveTarget) => void;
  onConfirmPruneSave: (target: SaveTarget) => void;
}

// 历史版本浮层 + 展开查看/恢复确认/版本容量满 三个 Dialog。
// 纯展示 + 调用回调；状态与编排由 useRevisionHistoryPanel 持有。
export function RevisionHistoryPanel({
  open,
  postId,
  historyPanelPosition,
  title,
  saving,
  revisionBusy,
  checkingRevisionLimit,
  revisionHistory,
  selectedRevisionId,
  expandedRevision,
  setExpandedRevision,
  pendingRestoreRevision,
  restorePruneCandidate,
  restoreCannotSnapshot,
  pruneCandidate,
  pendingSaveTarget,
  previewRevision,
  selectDefaultRevision,
  restoreDefaultPreview,
  openExpandedRevision,
  deleteSelectedRevision,
  requestRestore,
  restoreRevision,
  saveAndRestore,
  cancelRestore,
  cancelPrune,
  onSave,
  onConfirmPruneSave,
}: RevisionHistoryPanelProps) {
  return (
    <>
      {open && postId && createPortal(
        <section
          id="blog-history-popover"
          className="blog-history-popover fixed z-[60] grid h-[min(600px,calc(100dvh-2rem))] w-[calc(100vw-1rem)] max-w-[640px] overflow-hidden rounded-panel border border-border/70 bg-popover/96 p-2 shadow-2xl shadow-foreground/15 backdrop-blur-xl md:grid-cols-[220px_minmax(0,1fr)]"
          style={historyPanelPosition}
          aria-label="文章历史"
        >
          <div className="flex min-h-0 flex-col overflow-hidden border-b border-border/60 p-2 md:border-b-0 md:border-r">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <div className="text-body font-semibold text-foreground">历史版本</div>
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => onSave("draft")}
                disabled={saving || revisionBusy || checkingRevisionLimit}
              >
                保存版本
              </Button>
            </div>
            {revisionHistory.revisions.length === 0 ? (
              <p className="text-fine text-muted-foreground">还没有历史。保存版本或发布后会在这里创建版本。</p>
            ) : (
              <div
                className={cn(
                  "min-h-0 flex-1",
                  revisionHistory.revisions.length >= 10
                    ? "grid grid-rows-[repeat(10,minmax(0,1fr))] gap-1"
                    : "space-y-1",
                )}
                onMouseLeave={restoreDefaultPreview}
              >
                {revisionHistory.revisions.slice(0, 10).map((revision) => (
                  <button
                    key={revision.id}
                    type="button"
                    onMouseEnter={() => previewRevision(revision.id)}
                    onFocus={() => previewRevision(revision.id)}
                    onClick={() => selectDefaultRevision(revision.id)}
                    aria-pressed={selectedRevisionId === revision.id}
                    title={selectedRevisionId === revision.id ? "当前默认预览版本，点击取消选择" : "点击设为默认预览版本"}
                    className={cn(
                      "min-h-0 w-full overflow-hidden rounded-control px-2 py-1 text-left transition-colors",
                      revisionHistory.revisions.length >= 10 ? "h-full" : "py-1.5",
                      selectedRevisionId === revision.id ? "bg-primary/10 text-foreground" : "hover:bg-accent",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-fine font-medium leading-tight">版本 {revision.revision_number}</span>
                      <Badge variant={revision.is_published ? "success" : "secondary"} className="shrink-0 px-1.5 py-0 text-caption font-medium">
                        {revision.is_published ? "公开版本" : REVISION_KIND_LABELS[revision.kind]}
                      </Badge>
                    </span>
                    <span className="mt-0.5 block text-caption leading-tight text-muted-foreground">{formatRevisionTime(revision.created_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex min-h-0 flex-col overflow-hidden p-2">
            {revisionHistory.selected ? (
              <>
                <div className="mb-3 shrink-0 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex h-8 items-center text-body font-semibold text-foreground">版本 {revisionHistory.selected.revision_number}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={revisionHistory.selected.is_published ? "success" : "secondary"}
                        className="px-1.5 py-0 text-caption font-medium"
                      >
                        {revisionHistory.selected.is_published ? "公开版本" : REVISION_KIND_LABELS[revisionHistory.selected.kind]}
                      </Badge>
                      <span className="text-caption text-muted-foreground">{formatRevisionTime(revisionHistory.selected.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 self-start gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={openExpandedRevision}
                    >展开查看</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={revisionBusy}
                      onClick={() => requestRestore(revisionHistory.selected)}
                    >恢复</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                      disabled={revisionBusy || revisionHistory.selected.is_published}
                      title={revisionHistory.selected.is_published ? "公开版本受保护，不能删除" : "删除此历史版本"}
                      onClick={deleteSelectedRevision}
                    >删除</Button>
                  </div>
                </div>
                {revisionHistory.selected.title !== title && (
                  <div className="mb-3 shrink-0 rounded-control border border-border/60 bg-muted/35 px-3 py-2 text-fine text-foreground">
                    <span className="mr-1 text-muted-foreground">标题：</span>
                    {revisionHistory.selected.title}
                  </div>
                )}
                <div className="flex min-h-0 flex-1 flex-col rounded-control border border-border/60 bg-muted/25 p-3">
                  <div className="mb-2 text-caption font-medium text-muted-foreground">快速预览</div>
                  <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words font-sans text-fine leading-relaxed text-foreground">{revisionHistory.selected.content}</pre>
                </div>
              </>
            ) : (
              <p className="text-fine text-muted-foreground">{revisionHistory.loading ? "正在加载预览…" : "悬停一个历史版本查看内容。"}</p>
            )}
          </div>
        </section>,
        document.body,
      )}

      <Dialog open={expandedRevision != null} onOpenChange={(open) => !open && setExpandedRevision(null)}>
        <DialogContent className="max-h-[min(760px,calc(100dvh-2rem))] max-w-4xl gap-0 overflow-hidden p-0 sm:max-w-4xl">
          {expandedRevision && (
            <>
              <DialogHeader className="border-b border-border/70 p-5 pr-12">
                <DialogTitle>版本 {expandedRevision.revision_number} 完整内容</DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-2">
                  <Badge variant={expandedRevision.is_published ? "success" : "secondary"} className="px-1.5 py-0 text-caption font-medium">
                    {expandedRevision.is_published ? "公开版本" : REVISION_KIND_LABELS[expandedRevision.kind]}
                  </Badge>
                  <span>{formatRevisionTime(expandedRevision.created_at)}</span>
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[60dvh]">
                <div className="space-y-4 p-5">
                  {expandedRevision.title !== title && (
                    <div className="rounded-control border border-border/60 bg-muted/35 px-3 py-2 text-fine text-foreground">
                      <span className="mr-1 text-muted-foreground">标题：</span>
                      {expandedRevision.title}
                    </div>
                  )}
                  <div>
                    <div className="mb-2 text-caption font-medium text-muted-foreground">正文</div>
                    <pre className="whitespace-pre-wrap break-words font-sans text-body leading-relaxed text-foreground">{expandedRevision.content}</pre>
                  </div>
                </div>
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingRestoreRevision != null}
        onOpenChange={(open) => {
          if (!open) cancelRestore();
        }}
      >
        <DialogContent className="max-w-md">
          {pendingRestoreRevision && (
            <>
              <DialogHeader>
                <DialogTitle>当前修改尚未保存为版本</DialogTitle>
                <DialogDescription>
                  恢复版本 {pendingRestoreRevision.revision_number} 会覆盖这些修改。你可以先保存为版本，或直接放弃后恢复。
                </DialogDescription>
              </DialogHeader>
              {restorePruneCandidate && (
                <div className="rounded-control border border-border/60 bg-muted/35 px-3 py-2 text-fine text-foreground">
                  保存当前修改为版本会删除版本 {restorePruneCandidate.revision_number}，以保留最多 10 个历史版本。
                </div>
              )}
              {restoreCannotSnapshot && (
                <div className="rounded-control border border-destructive/30 bg-destructive/10 px-3 py-2 text-fine text-destructive">
                  历史版本已满，且没有可删除的非公开版本；无法在恢复前保存当前修改为版本。
                </div>
              )}
              <DialogFooter className="gap-2 sm:justify-between">
                <Button
                  variant="outline"
                  disabled={revisionBusy}
                  onClick={cancelRestore}
                >取消</Button>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    disabled={revisionBusy}
                    onClick={() => restoreRevision(pendingRestoreRevision.id)}
                  >放弃修改并恢复</Button>
                  <Button
                    disabled={revisionBusy || restoreCannotSnapshot}
                    onClick={() => saveAndRestore(pendingRestoreRevision)}
                  >保存版本并恢复</Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={pruneCandidate != null}
        onOpenChange={(open) => {
          if (!open) cancelPrune();
        }}
      >
        <DialogContent className="max-w-md">
          {pruneCandidate && pendingSaveTarget && (
            <>
              <DialogHeader>
                <DialogTitle>历史版本已满</DialogTitle>
                <DialogDescription>
                  {pendingSaveTarget === "published" && pruneCandidate.is_published
                    ? "发布新版本会替换并删除当前公开版本，删除后无法恢复。"
                    : "继续操作会删除最早的非公开版本，删除后无法恢复。"}
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-control border border-border/60 bg-muted/35 px-3 py-2 text-fine text-foreground">
                <div className="font-medium">版本 {pruneCandidate.revision_number}</div>
                <div className="mt-1 text-caption text-muted-foreground">
                  {pruneCandidate.is_published ? "公开版本" : REVISION_KIND_LABELS[pruneCandidate.kind]} · {formatRevisionTime(pruneCandidate.created_at)}
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={cancelPrune}
                >取消</Button>
                <Button
                  variant="destructive"
                  onClick={() => onConfirmPruneSave(pendingSaveTarget)}
                >
                  {pendingSaveTarget === "published" ? "删除并发布" : "删除并保存版本"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
