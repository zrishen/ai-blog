import { describe, expect, it } from "vitest";

import { parentPath } from "../../src/lib/path";

describe("parentPath", () => {
  it("顶层路径返回 null", () => {
    expect(parentPath("folder")).toBeNull();
    expect(parentPath("file.md")).toBeNull();
  });

  it("多级路径返回直接父目录", () => {
    expect(parentPath("a/b")).toBe("a");
    expect(parentPath("folder/sub/file.md")).toBe("folder/sub");
    expect(parentPath("a/b/c/d")).toBe("a/b/c");
  });

  it("父目录恰好是顶层时返回 null 的父级字符串", () => {
    expect(parentPath("docs/intro.md")).toBe("docs");
  });
});
