import { useState, useEffect } from "react";
import { getPreviewUrl } from "../api/client";
import { ExternalLink } from "lucide-react";

interface Props {
  filename: string;
}

export function FilePreview({ filename }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ext = filename.split(".").pop()?.toLowerCase();

  useEffect(() => {
    setLoading(true);
    setError(null);
  }, [filename]);

  const previewUrl = getPreviewUrl(filename);

  if (ext === "pdf") {
    return (
      <div className="flex flex-col flex-1 overflow-hidden h-full">
        <div className="flex items-center justify-between py-3 px-5 border-b border-border flex-shrink-0">
          <span className="text-sm font-medium">{filename}</span>
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary no-underline text-sm hover:underline flex items-center gap-1"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            在新窗口打开
          </a>
        </div>
        <div className="flex-1 relative overflow-hidden">
          <iframe
            src={previewUrl}
            className="w-full h-full border-none"
            onLoad={() => setLoading(false)}
            onError={() => { setError("加载失败"); setLoading(false); }}
            title={filename}
          />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm bg-background">
              加载中...
            </div>
          )}
          {error && (
            <div className="p-10 text-center text-red-500 text-sm">{error}</div>
          )}
        </div>
      </div>
    );
  }

  if (ext === "docx" || ext === "xlsx") {
    return <FilePreviewHTML url={previewUrl} filename={filename} />;
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden h-full">
      <div className="p-10 text-center text-red-500 text-sm">不支持预览该文件类型</div>
    </div>
  );
}

function FilePreviewHTML({ url, filename }: { url: string; filename: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setHtml(null);
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("加载失败");
        return res.text();
      })
      .then((text) => {
        setHtml(text);
        setLoading(false);
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [url]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden h-full">
      <div className="flex items-center justify-between py-3 px-5 border-b border-border flex-shrink-0">
        <span className="text-sm font-medium">{filename}</span>
      </div>
      <div className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm bg-background">
            加载中...
          </div>
        )}
        {error && (
          <div className="p-10 text-center text-red-500 text-sm">{error}</div>
        )}
        {html && (
          <div
            className="h-full overflow-y-auto p-0 text-sm leading-[1.8]"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}
