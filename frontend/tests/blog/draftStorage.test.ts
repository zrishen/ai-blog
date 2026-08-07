import { describe, it, expect, beforeEach } from "vitest";
import { draftRecoveryKey, clearAllDraftRecovery } from "../../src/features/blog/utils/draftStorage";

describe("draftStorage", () => {
  beforeEach(() => localStorage.clear());

  it("draftRecoveryKey 按 userId + postId 隔离，不同用户不串", () => {
    expect(draftRecoveryKey(1)).toBe("draft_blog_1_new");
    expect(draftRecoveryKey(1, 42)).toBe("draft_blog_1_42");
    // 同 postId、不同用户 → 不同 key，防止跨用户恢复出对方草稿
    expect(draftRecoveryKey(2, 42)).toBe("draft_blog_2_42");
    expect(draftRecoveryKey(1, 42)).not.toBe(draftRecoveryKey(2, 42));
  });

  it("clearAllDraftRecovery 只清 draft_blog_ 前缀，保留无关 key", () => {
    localStorage.setItem("draft_blog_1_new", "x");
    localStorage.setItem("draft_blog_2_3", "y");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("ws_view", "grid");
    clearAllDraftRecovery();
    expect(localStorage.getItem("draft_blog_1_new")).toBeNull();
    expect(localStorage.getItem("draft_blog_2_3")).toBeNull();
    // 无关 key 必须保留（登出不应误清用户偏好）
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("ws_view")).toBe("grid");
  });
});
