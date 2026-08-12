import { useEffect, useId, useRef, useState } from "react";

interface MermaidBlockProps {
  code: string;
}

// 主题直接读 document data-theme（chatStore effect 写入），避开组件直耦合全局 store
function readIsDark(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

// mermaid 是大包，动态 import 懒加载（首次遇到 mermaid 块才加载），避免增大首屏 bundle
type MermaidApi = typeof import("mermaid")["default"];
let mermaidPromise: Promise<MermaidApi> | null = null;
function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

// 记录已 initialize 的主题，避免重复初始化
let initializedTheme: string | null = null;

// 配色（明/暗两套）：base 主题 + themeVariables，复刻早期手绘示例的观感
const LIGHT_VARS = {
  primaryColor: "#fde68a",
  primaryTextColor: "#78350f",
  primaryBorderColor: "#b45309",
  lineColor: "#92400e",
  secondaryColor: "#fef3c7",
  tertiaryColor: "#fffbeb",
  fontFamily: "inherit",
};
const DARK_VARS = {
  primaryColor: "#3d2817",
  primaryTextColor: "#fde68a",
  primaryBorderColor: "#b45309",
  lineColor: "#d97706",
  secondaryColor: "#291a0d",
  tertiaryColor: "#1f1208",
  fontFamily: "inherit",
};

/** mermaid render 失败会在 body 残留错误 dom（id 形如 d{id} 或 {id}），清理掉 */
function cleanupMermaidDom(id: string) {
  for (const candidate of [`d${id}`, id]) {
    document.getElementById(candidate)?.remove();
  }
}

/**
 * 把 ```mermaid 代码块渲染成 SVG 图表。
 * - 主题跟随全局 dark/light
 * - 流式写入时源码快速变化：120ms 防抖 + 序号丢弃过期渲染
 * - 语法错误（流式未写完也常见）降级为源码展示，写完后自动重渲染
 */
export function MermaidBlock({ code }: MermaidBlockProps) {
  const [isDark, setIsDark] = useState(readIsDark);
  const reactId = useId();
  // mermaid render 需要合法 DOM id（useId 含冒号等非法字符）
  const renderId = `mmd-${reactId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);
  const seqRef = useRef(0);

  // 监听主题切换：data-theme 变化时重渲染图表（替代直接订阅 store）
  useEffect(() => {
    const observer = new MutationObserver(() => setIsDark(readIsDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // 兜底去掉可能混入的围栏（react-markdown 正常只传源码文本）
    const trimmed = code.replace(/^```mermaid\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
    if (!trimmed) return;

    const handle = setTimeout(async () => {
      const seq = ++seqRef.current;
      try {
        const mermaid = await loadMermaid();
        const key = isDark ? "base-dark" : "base-light";
        if (initializedTheme !== key) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "base",
            look: "handDrawn",
            handDrawnSeed: 1,
            themeVariables: isDark ? DARK_VARS : LIGHT_VARS,
            securityLevel: "strict",
          });
          initializedTheme = key;
        }
        const { svg: rendered } = await mermaid.render(renderId, trimmed);
        if (seqRef.current !== seq) return;
        setSvg(rendered);
        setErrored(false);
      } catch {
        if (seqRef.current !== seq) return;
        setErrored(true);
      } finally {
        // mermaid.render 无论成败都在 document 注入临时容器，统一清理防 DOM 泄漏
        cleanupMermaidDom(renderId);
      }
    }, 120);

    return () => clearTimeout(handle);
  }, [code, isDark, renderId]);

  if (errored) {
    return (
      <pre className="my-4 overflow-x-auto rounded-xl border border-border bg-muted/60 p-3 text-fine leading-relaxed text-muted-foreground">
        <code>{code}</code>
      </pre>
    );
  }

  if (!svg) {
    return (
      <div className="my-4 flex items-center justify-center rounded-xl border border-border/60 bg-muted/30 px-4 py-8 text-fine text-muted-foreground">
        正在渲染图表…
      </div>
    );
  }

  return (
    <div
      className="mermaid-chart my-4 flex justify-center overflow-x-auto rounded-xl border border-border/60 bg-card/40 px-4 py-5"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
