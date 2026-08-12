import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";

import {
  extractCodeLanguage,
  extractCodeText,
} from "@/utils/mermaidCode";

// 构造 react-markdown 渲染 <pre> 时传给 code 组件的 children 形态：
// 一个带 className="language-xxx" 的 <code> 元素。
function code(className: string | null, ...children: ReactNode[]) {
  return createElement("code", className === null ? null : { className }, ...children);
}

describe("extractCodeLanguage", () => {
  it("从 language-mermaid 提取 mermaid", () => {
    const node = code("language-mermaid", "graph TD");
    expect(extractCodeLanguage(node)).toBe("mermaid");
  });

  it("从 language-python 提取 python", () => {
    const node = code("language-python", "print(1)");
    expect(extractCodeLanguage(node)).toBe("python");
  });

  it("语言名含连字符整体保留（[\\w-]+ 捕获）", () => {
    const node = code("language-visual-mermaid", "x");
    expect(extractCodeLanguage(node)).toBe("visual-mermaid");
  });

  it("className 含多个 class，仍取出 language- 段", () => {
    const node = code("hljs language-go", "x");
    expect(extractCodeLanguage(node)).toBe("go");
  });

  it("language- 在非起始位置也能命中（match 非锚定）", () => {
    const node = code("token language-rust extra", "x");
    expect(extractCodeLanguage(node)).toBe("rust");
  });

  it("className 无 language- 前缀返回空串", () => {
    const node = code("token keyword", "x");
    expect(extractCodeLanguage(node)).toBe("");
  });

  it("无 className 属性返回空串", () => {
    const node = code(null, "x");
    expect(extractCodeLanguage(node)).toBe("");
  });

  it("children 为空字符串返回空串", () => {
    expect(extractCodeLanguage("")).toBe("");
  });

  it("children 为纯字符串（非元素）返回空串", () => {
    expect(extractCodeLanguage("language-mermaid")).toBe("");
  });

  it("children 为 null/undefined 返回空串", () => {
    expect(extractCodeLanguage(null)).toBe("");
    expect(extractCodeLanguage(undefined)).toBe("");
  });

  it("数组中多个元素，取第一个匹配到 language- 的", () => {
    const noLang = code("token", "x");
    const withLang = code("language-js", "y");
    expect(extractCodeLanguage([noLang, withLang])).toBe("js");
  });
});

describe("extractCodeText", () => {
  it("字符串子节点原样返回", () => {
    const node = code("language-mermaid", "graph TD\n  A-->B");
    expect(extractCodeText(node)).toBe("graph TD\n  A-->B");
  });

  it("空字符串子节点返回空串", () => {
    const node = code("language-mermaid", "");
    expect(extractCodeText(node)).toBe("");
  });

  it("数组子节点（多个字符串）拼接返回", () => {
    const node = code("language-text", "a", "b", "c");
    expect(extractCodeText(node)).toBe("abc");
  });

  it("数组含非字符串元素：元素转为空串、字符串保留", () => {
    const inner = createElement("span", null, "ignored");
    const node = code("language-text", "keep", inner, "tail");
    // inner 是 ReactElement，typeof !== "string" → ""；拼接为 "keeptail"
    expect(extractCodeText(node)).toBe("keeptail");
  });

  it("props.children 为单个数字时返回空串（非字符串/非数组）", () => {
    const node = code("language-text", 42);
    expect(extractCodeText(node)).toBe("");
  });

  it("纯字符串 children（无包裹元素）返回空串", () => {
    expect(extractCodeText("plain string")).toBe("");
  });

  it("children 为 null/undefined 返回空串", () => {
    expect(extractCodeText(null)).toBe("");
    expect(extractCodeText(undefined)).toBe("");
  });

  it("数组中首个有 props 的元素子节点为非字符串时不返回，继续到下一个", () => {
    // 第一个 code 元素的 children 是数字（不返回），第二个是字符串
    const numeric = code("language-x", 7);
    const textual = code("language-y", "found");
    expect(extractCodeText([numeric, textual])).toBe("found");
  });
});
