import React from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatProvider, useChat } from "../../src/stores/chatStore";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChatProvider>{children}</ChatProvider>
);

describe("chatStore 博客 AI 修改流", () => {
  it("按 START、APPEND、CLEAR 顺序维护补丁内容", () => {
    const { result } = renderHook(() => useChat(), { wrapper });

    act(() => {
      result.current.dispatch({ type: "START_BLOG_PATCH_STREAMING", payload: { targetText: "旧文本" } });
      result.current.dispatch({ type: "APPEND_BLOG_PATCH_STREAMING", payload: { replacementDelta: "新的" } });
      result.current.dispatch({ type: "APPEND_BLOG_PATCH_STREAMING", payload: { replacementDelta: "文本" } });
    });

    expect(result.current.state.blogPatchStreaming).toEqual({
      targetText: "旧文本",
      replacementDelta: "新的文本",
    });

    act(() => {
      result.current.dispatch({ type: "CLEAR_BLOG_PATCH_STREAMING" });
    });

    expect(result.current.state.blogPatchStreaming).toBeNull();
  });

  it("忽略没有起始补丁的增量，新的 START 会替换旧补丁", () => {
    const { result } = renderHook(() => useChat(), { wrapper });

    act(() => {
      result.current.dispatch({ type: "APPEND_BLOG_PATCH_STREAMING", payload: { replacementDelta: "幽灵文本" } });
    });
    expect(result.current.state.blogPatchStreaming).toBeNull();

    act(() => {
      result.current.dispatch({ type: "START_BLOG_PATCH_STREAMING", payload: { targetText: "第一个目标" } });
      result.current.dispatch({ type: "APPEND_BLOG_PATCH_STREAMING", payload: { replacementDelta: "旧替换" } });
      result.current.dispatch({ type: "START_BLOG_PATCH_STREAMING", payload: { targetText: "第二个目标" } });
    });

    expect(result.current.state.blogPatchStreaming).toEqual({
      targetText: "第二个目标",
      replacementDelta: "",
    });
  });

  it("登出时清除选区上下文和进行中的补丁", () => {
    const { result } = renderHook(() => useChat(), { wrapper });

    act(() => {
      result.current.dispatch({
        type: "SET_AI_SELECTION_CONTEXT",
        payload: { postId: 42, selectedText: "需要修改的原文", sectionIndex: 2 },
      });
      result.current.dispatch({ type: "START_BLOG_PATCH_STREAMING", payload: { targetText: "需要修改的原文" } });
      result.current.dispatch({ type: "APPEND_BLOG_PATCH_STREAMING", payload: { replacementDelta: "修改结果" } });
      result.current.dispatch({ type: "LOGOUT" });
    });

    expect(result.current.state.aiSelectionContext).toBeNull();
    expect(result.current.state.blogPatchStreaming).toBeNull();
  });
});
