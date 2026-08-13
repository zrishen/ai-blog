import { X } from "lucide-react";

import { FileProcessingProgress } from "./FileProcessingProgress";

import type { UploadTask } from "./FileProcessingProvider";

interface UploadOverlayProps {
  uploadTask: UploadTask;
  queueLength: number;
  onClose: () => void;
}

/** 上传浮层：固定在顶部居中，展示当前上传进度或失败信息 */
export function UploadOverlay({ uploadTask, queueLength, onClose }: UploadOverlayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="file-processing-upload-overlay"
      className="fixed top-20 left-1/2 z-50 w-[380px] max-w-[90vw] -translate-x-1/2 rounded-panel border border-border/70 bg-card/95 px-4 py-3 shadow-2xl shadow-foreground/10 backdrop-blur-xl"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 truncate text-meta font-medium">{uploadTask.fileName}</div>
        {uploadTask.status === "failed" && (
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭上传提示"
            className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {uploadTask.status === "failed" ? (
        <div className="text-fine leading-relaxed text-destructive">{uploadTask.error}</div>
      ) : (
        <>
          <FileProcessingProgress value={uploadTask} />
          {queueLength > 0 && (
            <div className="mt-1 text-meta text-muted-foreground">还有 {queueLength} 个文件等待上传</div>
          )}
        </>
      )}
    </div>
  );
}
