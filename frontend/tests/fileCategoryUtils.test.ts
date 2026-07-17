import { describe, expect, it } from "vitest";
import type { FileCategory } from "../src/stores/chatStore";
import { collectDescendantIds } from "../src/components/left-sidebar/fileCategoryUtils";
import { parseDragSource } from "../src/components/left-sidebar/dragSource";

const categories: FileCategory[] = [
  {
    id: 1,
    name: "根分类",
    slug: "root",
    parent_id: null,
    created_at: "",
    children: [
      {
        id: 2,
        name: "子分类",
        slug: "child",
        parent_id: 1,
        created_at: "",
        children: [
          {
            id: 3,
            name: "孙分类",
            slug: "grandchild",
            parent_id: 2,
            created_at: "",
          },
        ],
      },
    ],
  },
  {
    id: 4,
    name: "其他分类",
    slug: "other",
    parent_id: null,
    created_at: "",
  },
];

describe("fileCategoryUtils", () => {
  it("收集目标分类及其全部后代 ID", () => {
    expect(collectDescendantIds(1, categories)).toEqual([1, 2, 3]);
    expect(collectDescendantIds(2, categories)).toEqual([2, 3]);
  });

  it("目标分类不存在时返回空数组", () => {
    expect(collectDescendantIds(99, categories)).toEqual([]);
  });

  it("解析分类、文件和旧格式拖拽来源", () => {
    expect(parseDragSource("cat:2")).toEqual({ kind: "cat", id: 2 });
    expect(parseDragSource("file:8")).toEqual({ kind: "file", id: 8 });
    expect(parseDragSource("3")).toEqual({ kind: "cat", id: 3 });
    expect(parseDragSource("cat:0")).toBeNull();
    expect(parseDragSource("invalid")).toBeNull();
  });
});
