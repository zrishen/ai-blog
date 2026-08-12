import { describe, it, expect } from "vitest";

import {
  expandBlankLines,
  preserveBlankLines,
} from "../../src/features/blog/utils/markdownBlankLines";

// 零宽空格（expandBlankLines 写入的空行占位符）
const ZWSP = "​";

describe("expandBlankLines", () => {
  it("无多余换行时原样返回", () => {
    expect(expandBlankLines("段1\n\n段2")).toBe("段1\n\n段2");
  });

  it("3 个换行(1 个空行)转成 1 个 ZWSP 段", () => {
    const out = expandBlankLines("段1\n\n\n段2");
    expect(out).toBe("段1\n\n​\n\n段2");
  });

  it("5 个换行(3 个空行)转成 3 个 ZWSP 段", () => {
    const out = expandBlankLines("段1\n\n\n\n\n段2");
    expect(out).toBe("段1\n\n​\n\n​\n\n​\n\n段2");
  });

  it("空字符串原样返回", () => {
    expect(expandBlankLines("")).toBe("");
  });

  it("normalize 闭环: ZWSP 段被清理后与 DOM 非空块对齐", () => {
    // 模拟 preserveBlankLines 内部的 normalize 步骤
    const mdFromGetValue = "段1\n\n​\n\n段2";
    // eslint-disable-next-line no-irregular-whitespace, no-misleading-character-class
    const normalized = mdFromGetValue.replace(/[​‌‍⁠]/g, "").replace(/\n{3,}/g, "\n\n");
    expect(normalized).toBe("段1\n\n段2");
    const segments = normalized.split(/\n{2,}/);
    expect(segments).toEqual(["段1", "段2"]);
  });
});

describe("preserveBlankLines", () => {
  function makeResetEl(blocks: Array<{ tag: string; text: string }>): HTMLElement {
    const el = document.createElement("div");
    for (const b of blocks) {
      const child = document.createElement(b.tag);
      child.textContent = b.text;
      el.appendChild(child);
    }
    return el;
  }

  it("resetEl 为空时原样返回 markdown", () => {
    expect(preserveBlankLines(null, "hello world")).toBe("hello world");
  });

  it("DOM 无空白段落时原样返回 markdown", () => {
    const el = makeResetEl([{ tag: "P", text: "hello world with spaces" }]);
    expect(preserveBlankLines(el, "hello world with spaces")).toBe("hello world with spaces");
  });

  it("保留正文中的英文空格，不会把单词粘连（\\s 误删回归）", () => {
    const el = makeResetEl([
      { tag: "P", text: "hello world with spaces" },
      { tag: "P", text: ZWSP }, // 空白段落触发处理
      { tag: "P", text: "second paragraph here" },
    ]);
    const md = `hello world with spaces\n\n${ZWSP}\n\nsecond paragraph here`;
    const out = preserveBlankLines(el, md);
    // 修复前 STRIP_INVISIBLE_RE 含 \s，会把空格全部删除，粘连成 helloworld...
    expect(out).toContain("hello world with spaces");
    expect(out).toContain("second paragraph here");
    expect(out).not.toContain("helloworld");
    expect(out).not.toContain("secondparagraph");
  });

  it("保留标题、列表结构与段落边界，不会压成一行", () => {
    const el = makeResetEl([
      { tag: "H2", text: "标题" },
      { tag: "P", text: ZWSP },
      { tag: "P", text: "正文带 空格 的段落" },
    ]);
    const md = `## 标题\n\n${ZWSP}\n\n正文带 空格 的段落`;
    const out = preserveBlankLines(el, md);
    expect(out).toContain("## 标题");
    expect(out).toContain("正文带 空格 的段落");
    // 修复前 \s 会删除所有换行，输出被压成单行
    expect(out.split("\n").length).toBeGreaterThan(2);
  });

  it("代码块内的换行与缩进不被压扁", () => {
    const code = "const x = 1;\nconst y = 2;";
    const el = makeResetEl([
      { tag: "P", text: "intro text" },
      { tag: "P", text: ZWSP },
      { tag: "PRE", text: code },
    ]);
    const md = `intro text\n\n${ZWSP}\n\n\`\`\`\n${code}\n\`\`\``;
    const out = preserveBlankLines(el, md);
    expect(out).toContain("const x = 1;");
    expect(out).toContain("const y = 2;");
    expect(out).toContain("intro text");
  });
});
