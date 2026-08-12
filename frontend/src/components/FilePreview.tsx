import { useState, useEffect } from "react";

import { apiFetch } from "@/api/client";
import { getPreviewBaseUrl, getPreviewPdfUrl } from "@/api/files";

interface Props {
  filename: string;
}

export function FilePreview({ filename }: Props) {
  const ext = filename.split(".").pop()?.toLowerCase();

  if (ext === "pdf") {
    return <PdfPreview key={filename} filename={filename} />;
  }

  if (ext === "docx" || ext === "xlsx") {
    return <FilePreviewHTML key={filename} filename={filename} />;
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden h-full">
      <div className="p-10 text-center text-destructive text-body">不支持预览该文件类型</div>
    </div>
  );
}

function PdfPreview({ filename }: { filename: string }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // iframe 无法注入 header，先换 scoped 预览令牌（仅可预览该文件）再设 src。
  // filename 变化由父组件 key={filename} 触发重挂载重置 state，effect 内只做异步取数。
  useEffect(() => {
    let alive = true;
    getPreviewPdfUrl(filename)
      .then((url) => {
        if (alive) setPreviewUrl(url);
      })
      .catch(() => {
        if (alive) {
          setError("加载失败");
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [filename]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden h-full">
      <div className="flex-1 relative overflow-hidden">
        {previewUrl && (
          <iframe
            src={previewUrl}
            className="w-full h-full border-none"
            onLoad={() => setLoading(false)}
            onError={() => { setError("加载失败"); setLoading(false); }}
            title={filename}
          />
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-body bg-background">
            加载中...
          </div>
        )}
        {error && (
          <div className="p-10 text-center text-destructive text-body">{error}</div>
        )}
      </div>
    </div>
  );
}

function FilePreviewHTML({ filename }: { filename: string }) {
  const url = getPreviewBaseUrl(filename);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // apiFetch 自动带 Authorization header（access token），401 自动刷新；凭证不再入 URL。
    apiFetch(url, { signal: controller.signal })
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
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-body bg-background">
            加载中...
          </div>
        )}
        {error && (
          <div className="p-10 text-center text-destructive text-body">{error}</div>
        )}
        {html && (
          <div
            className="h-full overflow-auto p-0 text-body leading-[1.8] md:overflow-x-hidden md:overflow-y-auto max-md:[&_img]:max-w-none max-md:[&_table]:min-w-max"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}
