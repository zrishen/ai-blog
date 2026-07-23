import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..");

describe("trashRevision 监听器已就位", () => {
  const cases: Array<{ name: string; rel: string; marker: string; revisionKey?: string; effectCount?: number }> = [
    {
      name: "AISidebar 监听 trashRevision 刷新对话",
      rel: path.join("src", "features", "ai-chat", "AISidebar.tsx"),
      marker: "[isAuthenticated, isInitializing, isPrivate, loadConvs, state.trashRevision, userId]",
      revisionKey: "state.trashRevision",
      effectCount: 1,
    },
    {
      name: "FilePanel 监听 fileLibraryRevision 刷新文件",
      rel: path.join("src", "features", "file", "components", "FilePanel.tsx"),
      marker: "[isAuthenticated, state.currentPage, state.fileLibraryRevision, loadFileDocs]",
      revisionKey: "state.fileLibraryRevision",
      effectCount: 1,
    },
    {
      name: "BlogPage 监听 trashRevision 刷新文章列表",
      rel: path.join("src", "features", "blog", "components", "BlogPage.tsx"),
      marker: "[loadPosts, state.trashRevision]",
      revisionKey: "state.trashRevision",
      effectCount: 1,
    },
    {
      name: "BlogEditor 监听 trashRevision 自动退回列表",
      rel: path.join("src", "features", "blog", "components", "BlogEditor.tsx"),
      marker: "state.trashRevision",
    },
  ];

  for (const c of cases) {
    it(`${c.name}`, () => {
      const file = path.resolve(root, c.rel);
      const src = fs.readFileSync(file, "utf-8");
      expect(src).toContain(c.marker);
      if (c.revisionKey && c.effectCount != null) {
        expect(src.split(c.revisionKey).length - 1).toBe(c.effectCount);
      }
    });
  }
});
