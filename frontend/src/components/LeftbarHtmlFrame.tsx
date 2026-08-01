import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { readThemeTokens, themeTokensToCss } from "@/lib/readThemeTokens";

// 博客主页左栏：渲染博主用 AI 生成的自包含 HTML（iframe 沙箱隔离）。
// - sandbox="allow-same-origin"（不放 allow-scripts）→ AI 的 JS 不执行；
//   same-origin 让父页能读 iframe.contentDocument 做高度自适应。
// - DOMPurify 注入前清洗（去 script/事件属性）双保险。
// - 主题靠 CSS 变量注入（iframe 内 var(--background) 跟随明暗）。
export function LeftbarHtmlFrame({
  html,
  theme,
  onHeightChange,
}: {
  html: string;
  theme: "dark" | "light";
  onHeightChange?: (height: number) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<string>("");
  const [height, setHeight] = useState<number | null>(null);
  // 回调用 ref 承接，避免把它放进 measure effect 依赖、每次父渲染都重订阅 iframe
  const onHeightChangeRef = useRef(onHeightChange);
  useEffect(() => {
    onHeightChangeRef.current = onHeightChange;
  });

  // 生成 srcdoc：sanitize + 注入主题 CSS 变量。rAF 确保读到最新主题 DOM
  // （父组件 ChatProvider 在 effect 里写 data-theme，rAF 在所有 commit effect 之后执行）。
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      // 保留 <style> 标签：DOMPurify 默认像 <script> 一样移除 <style>，会把 AI 写的内联
      // CSS 全清掉（只剩裸 HTML 结构）。必须 ADD_TAGS + FORCE_BODY 同时使用才能真正放行
      // （FORCE_BODY 把输入当 body 片段处理，使 style 标签得以保留）；仍会清洗
      // expression()/javascript: 等危险 CSS，安全靠 iframe sandbox + prompt 兜底。
      const cleaned = DOMPurify.sanitize(html, { ADD_TAGS: ["style"], FORCE_BODY: true });
      const css = themeTokensToCss(readThemeTokens());
      setDoc(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}body{margin:0;background:transparent;color:inherit;}*{box-sizing:border-box;}img{max-width:100%;height:auto;}</style></head><body>${cleaned}</body></html>`,
      );
    });
    return () => cancelAnimationFrame(id);
  }, [html, theme]);

  // 高度自适应：srcdoc 加载后测 body 高度，ResizeObserver 跟随内容变化。
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !doc) return;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      const h = iframe.contentDocument?.body?.scrollHeight;
      if (h) {
        setHeight((prev) => {
          if (prev === h) return prev;
          onHeightChangeRef.current?.(h);
          return h;
        });
      }
    };
    const onLoad = () => {
      measure();
      const body = iframe.contentDocument?.body;
      if (body) {
        ro = new ResizeObserver(measure);
        ro.observe(body);
      }
    };
    iframe.addEventListener("load", onLoad);
    return () => {
      iframe.removeEventListener("load", onLoad);
      ro?.disconnect();
    };
  }, [doc]);

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin"
      srcDoc={doc}
      title="自定义左栏"
      style={{
        width: "100%",
        height: height != null ? `${height}px` : "120px",
        border: "0",
        display: "block",
        // 透明背景：让外层卡片（Surface）背景透出，AI 根元素保持透明即可贴合卡片，避免双层背景
        background: "transparent",
      }}
    />
  );
}
