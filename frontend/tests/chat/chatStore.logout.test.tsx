import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatProvider, useChat } from "../../src/stores/chatStore";

import type { BrainStats } from "../../src/api/brain";

const POLLUTED_FOLDER = "users/42/private-leak";
const POLLUTED_STATS: BrainStats = {
  enabled: true,
  entities: 9,
  facts: 8,
  episodes: 7,
  preferences: 6,
  chunks: 5,
  documents: 4,
};

describe("chatStore LOGOUT 全量重置", () => {
  it("登出后所有用户级字段回到默认，无跨账户残留", () => {
    const { result } = renderHook(() => useChat(), { wrapper: ChatProvider });
    const fileLibBefore = result.current.state.fileLibraryRevision;
    const trashBefore = result.current.state.trashRevision;

    act(() => {
      result.current.dispatch({ type: "SET_WORKSPACE_SELECTED_FOLDER_PATH", payload: POLLUTED_FOLDER });
      result.current.dispatch({ type: "SET_PAGE", payload: "workspace" });
      result.current.dispatch({ type: "TOGGLE_PLUGIN_CENTER" });
      result.current.dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: false });
      result.current.dispatch({ type: "SET_LLM_SUPPORTS_THINKING", payload: false });
      result.current.dispatch({ type: "SET_AI_SIDEBAR_CONV_ID", payload: 777 });
      result.current.dispatch({ type: "SET_AI_SIDEBAR_SELECTED_KEY", payload: "server:777" });
      result.current.dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: 123 });
      result.current.dispatch({ type: "SET_BLOG_SELECTED_TAG", payload: "leaked-tag" });
      result.current.dispatch({ type: "SET_FILE_SELECTED_FILE", payload: "users/42/secret.md" });
      result.current.dispatch({ type: "SET_WORKSPACE_EDITING_BLOG", payload: 55 });
      result.current.dispatch({ type: "SET_BRAIN_STATS", payload: POLLUTED_STATS });
      result.current.dispatch({ type: "SET_ENABLED_SKILLS", payload: ["writing"] });
      result.current.dispatch({ type: "LOGOUT" });
    });

    const s = result.current.state;
    expect(s.workspaceSelectedFolderPath).toBeNull();
    expect(s.currentPage).toBe("blog");
    expect(s.pluginCenterOpen).toBe(false);
    expect(s.aiSidebarOpen).toBe(true);
    expect(s.llmSupportsThinking).toBe(true);
    expect(s.aiSidebarConversationId).toBeNull();
    expect(s.aiSidebarSelectedKey).toBeNull();
    expect(s.blogCurrentPostId).toBeNull();
    expect(s.blogSelectedTag).toBeNull();
    expect(s.fileSelectedFile).toBeNull();
    expect(s.workspaceEditingBlogId).toBeNull();
    expect(s.brainStats).toBeNull();
    expect(s.enabledSkills).toBeNull();
    expect(s.skillsLoaded).toBe(false);
    expect(s.aiSidebarMessagesByKey).toEqual({});
    expect(s.aiSidebarAttachmentsByKey).toEqual({});
    expect(s.blogPosts).toEqual([]);
    expect(s.fileLibraryRevision).toBe(fileLibBefore + 1);
    expect(s.trashRevision).toBe(trashBefore + 1);
  });

  it("auth:logout 事件桥接到 LOGOUT：reducer 在事件触发时重置用户字段", () => {
    const { result } = renderHook(() => useChat(), { wrapper: ChatProvider });
    act(() => {
      result.current.dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: 999 });
      result.current.dispatch({ type: "SET_AI_SIDEBAR_SELECTED_KEY", payload: "server:999" });
    });
    expect(result.current.state.blogCurrentPostId).toBe(999);
    expect(result.current.state.aiSidebarSelectedKey).toBe("server:999");

    act(() => {
      window.dispatchEvent(new Event("auth:logout"));
    });

    expect(result.current.state.blogCurrentPostId).toBeNull();
    expect(result.current.state.aiSidebarSelectedKey).toBeNull();
  });
});
