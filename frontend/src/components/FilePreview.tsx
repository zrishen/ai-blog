import { useState, useEffect } from "react";
import { getPreviewUrl } from "../api/client";

interface Props {
  filename: string;
}

export function FilePreview({ filename }: Props) {
  const ext = filename.split(".").pop()?.toLowerCase();
  const previewUrl = getPreviewUrl(filename);

  if (ext === "pdf") {
    return <PdfPreview key={previewUrl} filename={filename} previewUrl={previewUrl} />;
  }

  if (ext === "docx" || ext === "xlsx") {
    return <FilePreviewHTML key={previewUrl} url={previewUrl} />;
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden h-full">
      <div className="p-10 text-center text-red-500 text-sm">不支持预览该文件类型</div>
    </div>
  );
}

function PdfPreview({ filename, previewUrl }: { filename: string; previewUrl: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col flex-1 overflow-hidden h-full">
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

function FilePreviewHTML({ url }: { url: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
