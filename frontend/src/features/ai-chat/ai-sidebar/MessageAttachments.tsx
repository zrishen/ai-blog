import { useEffect, useState } from "react";
import { Download, FileText, Image as ImageIcon } from "lucide-react";

import { getChatAttachmentBlob } from "../../../api/chatAttachments";

import type { ChatAttachment } from "../types";

import { Spinner } from "@/components/ui/spinner";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PrivateAttachmentImage({ attachment }: { attachment: ChatAttachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void getChatAttachmentBlob(attachment.id, controller.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id]);

  if (failed) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl bg-muted/60 text-fine text-muted-foreground">
        图片预览失败
      </div>
    );
  }
  if (!url) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
        <Spinner className="h-4 w-4" />
      </div>
    );
  }
  return <img src={url} alt={attachment.original_name} className="max-h-52 w-full rounded-xl object-cover" />;
}

async function downloadAttachment(attachment: ChatAttachment) {
  const blob = await getChatAttachmentBlob(attachment.id);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = attachment.original_name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function MessageAttachments({ attachments }: { attachments?: ChatAttachment[] }) {
  if (!attachments?.length) return null;
  const ordered = [...attachments].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  return (
    <div className="mb-2 flex flex-col gap-2">
      {ordered.map((attachment) => attachment.kind === "image" || attachment.mime_type.startsWith("image/") ? (
        <button
          key={attachment.id}
          type="button"
          className="max-w-72 rounded-xl text-left"
          title={`下载 ${attachment.original_name}`}
          onClick={() => void downloadAttachment(attachment)}
        >
          <PrivateAttachmentImage attachment={attachment} />
          <span className="mt-1 flex items-center gap-1 truncate text-caption text-muted-foreground">
            <ImageIcon className="h-3 w-3" />
            {attachment.original_name}
          </span>
        </button>
      ) : (
        <button
          key={attachment.id}
          type="button"
          className="flex max-w-72 items-center gap-2 rounded-xl border border-border/60 bg-background/55 px-3 py-2 text-left hover:bg-accent/60"
          onClick={() => void downloadAttachment(attachment)}
        >
          <FileText className="h-4 w-4 flex-none text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-fine font-medium">{attachment.original_name}</span>
            <span className="block text-caption text-muted-foreground">{formatSize(attachment.size_bytes)}</span>
          </span>
          <Download className="h-3.5 w-3.5 flex-none text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}
