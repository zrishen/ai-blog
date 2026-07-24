import type { ReactNode, ReactElement } from "react";

/** 从 react-markdown 渲染出的 <pre><code class="language-xxx"> 中提取语言名 */
export function extractCodeLanguage(children: ReactNode): string {
  const childArray = Array.isArray(children) ? children : [children];
  for (const child of childArray) {
    if (child && typeof child === "object" && "props" in child) {
      const className = ((child as ReactElement<{ className?: string }>).props?.className) ?? "";
      const match = className.match(/language-([\w-]+)/);
      if (match) return match[1];
    }
  }
  return "";
}

/** 从 react-markdown 的 <pre><code> 中提取代码文本（mermaid 源码） */
export function extractCodeText(children: ReactNode): string {
  const childArray = Array.isArray(children) ? children : [children];
  for (const child of childArray) {
    if (child && typeof child === "object" && "props" in child) {
      const codeChildren = (child as ReactElement<{ children?: ReactNode }>).props?.children;
      if (typeof codeChildren === "string") return codeChildren;
      if (Array.isArray(codeChildren)) {
        return codeChildren.map((c) => (typeof c === "string" ? c : "")).join("");
      }
    }
  }
  return "";
}
