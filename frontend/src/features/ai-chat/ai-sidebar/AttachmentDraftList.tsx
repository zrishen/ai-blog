import { AlertCircle, FileText, Image as ImageIcon, RotateCcw, X } from "lucide-react";

import type { DraftAttachment } from "@/types/chat";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";

interface AttachmentDraftListProps {
  attachments: DraftAttachment[];
  disabled?: boolean;
  getPreviewUrl: (localId: string) => string | undefined;
  onRetry: (localId: string) => void;
  onRemove: (localId: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentDraftList({
  attachments,
  disabled,
  getPreviewUrl,
  onRetry,
  onRemove,
}: AttachmentDraftListProps) {
  // 点击发送后，附件已经进入当前用户消息，不再占用输入区；
  // 若请求失败，发送流程会把状态恢复为 uploaded 并重新显示，方便直接重试。
  const visibleAttachments = attachments.filter((draft) => draft.status !== "sending");
  if (visibleAttachments.length === 0) return null;

  return (
    <div
      className="flex gap-2 overflow-x-auto px-1"
      aria-label="待发送附件"
      data-testid="attachment-draft-tray"
    >
      {visibleAttachments.map((draft) => {
        const previewUrl = getPreviewUrl(draft.localId);
        const isBusy = draft.status === "queued" || draft.status === "uploading" || draft.status === "sending";
        return (
          <div
            key={draft.localId}
            className="relative flex w-52 flex-none items-center gap-2 rounded-xl border border-border/60 bg-muted/45 p-2"
          >
            <div className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-lg bg-background text-muted-foreground">
              {previewUrl ? (
                <img src={previewUrl} alt="" className="h-full w-full object-cover" />
              ) : draft.file.type.startsWith("image/") ? (
                <ImageIcon className="h-4 w-4" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-fine font-medium text-foreground" title={draft.file.name}>{draft.file.name}</p>
              <div className="mt-1 flex items-center gap-1 text-caption text-muted-foreground">
                {isBusy && <Spinner className="h-3 w-3" />}
                {draft.status === "failed" && <AlertCircle className="h-3 w-3 text-destructive" />}
                <span className={draft.status === "failed" ? "truncate text-destructive" : "truncate"}>
                  {draft.status === "queued" && "等待上传"}
                  {draft.status === "uploading" && `上传中 ${Math.max(1, draft.progress)}%`}
                  {draft.status === "uploaded" && formatSize(draft.file.size)}
                  {draft.status === "sending" && "正在发送"}
                  {draft.status === "failed" && (draft.error ?? "上传失败")}
                </span>
              </div>
              {draft.status === "uploading" && (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-border/70">
                  <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max(1, draft.progress)}%` }} />
                </div>
              )}
            </div>
            <div className="flex flex-none items-center">
              {draft.status === "failed" && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 w-7 rounded-full p-0"
                  aria-label={`重试上传 ${draft.file.name}`}
                  disabled={disabled}
                  onClick={() => onRetry(draft.localId)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                className="h-7 w-7 rounded-full p-0 text-muted-foreground hover:text-destructive"
                aria-label={`移除附件 ${draft.file.name}`}
                disabled={disabled || draft.status === "sending"}
                onClick={() => onRemove(draft.localId)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
