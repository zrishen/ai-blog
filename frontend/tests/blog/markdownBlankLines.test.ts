import { describe, it, expect } from "vitest";
import { expandBlankLines } from "../../src/features/blog/utils/markdownBlankLines";

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
    const normalized = mdFromGetValue.replace(/[ ​‌‍⁠]/g, "").replace(/\n{3,}/g, "\n\n");
    expect(normalized).toBe("段1\n\n段2");
    const segments = normalized.split(/\n{2,}/);
    expect(segments).toEqual(["段1", "段2"]);
  });
});
