import React from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatProvider, useChat } from "../../src/stores/chatStore";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChatProvider>{children}</ChatProvider>
);

describe("chatStore 博客 AI 流式状态", () => {
  it("按 postId 隔离全文流，迟到旧 run 不得污染或清除新 run", () => {
    const { result } = renderHook(() => useChat(), { wrapper });

    act(() => {
      result.current.dispatch({ type: "START_BLOG_STREAMING", payload: { postId: 1, runId: "conv-a:1:0" } });
      result.current.dispatch({ type: "APPEND_BLOG_STREAMING", payload: { postId: 1, runId: "conv-a:1:0", contentDelta: "文章一" } });
      result.current.dispatch({ type: "START_BLOG_STREAMING", payload: { postId: 2, runId: "conv-b:1:0" } });
      result.current.dispatch({ type: "APPEND_BLOG_STREAMING", payload: { postId: 2, runId: "conv-b:1:0", contentDelta: "文章二" } });
    });

    expect(result.current.state.blogStreamingByPostId).toEqual({
      1: { runId: "conv-a:1:0", content: "文章一", status: "streaming" },
      2: { runId: "conv-b:1:0", content: "文章二", status: "streaming" },
    });

    act(() => {
      result.current.dispatch({ type: "START_BLOG_STREAMING", payload: { postId: 1, runId: "conv-a:2:0" } });
      result.current.dispatch({ type: "APPEND_BLOG_STREAMING", payload: { postId: 1, runId: "conv-a:1:0", contentDelta: "迟到旧内容" } });
      result.current.dispatch({ type: "CLEAR_BLOG_STREAMING", payload: { postId: 1, runId: "conv-a:1:0" } });
      result.current.dispatch({ type: "APPEND_BLOG_STREAMING", payload: { postId: 1, runId: "conv-a:2:0", contentDelta: "新正文" } });
    });

    expect(result.current.state.blogStreamingByPostId[1]).toEqual({
      runId: "conv-a:2:0",
      content: "新正文",
      status: "streaming",
    });
    expect(result.current.state.blogStreamingByPostId[2]?.content).toBe("文章二");
  });

  it("SET_BLOG_POSTS 列表项缺少正文时保留已加载的详情正文（create 草稿刷新不冲掉当前文章）", () => {
    const { result } = renderHook(() => useChat(), { wrapper });

    act(() => {
      result.current.dispatch({ type: "SET_BLOG_POSTS", payload: [
        { id: 1, title: "文章A", slug: "a", content: "正文A", status: "published", view_count: 0, created_at: "2026-07-23" },
        { id: 2, title: "文章B", slug: "b", content: "正文B", status: "draft", view_count: 0, created_at: "2026-07-23" },
      ] });
    });

    // create_post 等触发的列表刷新：列表接口返回项不带 content
    act(() => {
      result.current.dispatch({ type: "SET_BLOG_POSTS", payload: [
        { id: 1, title: "文章A", slug: "a", status: "published", view_count: 0, created_at: "2026-07-23" },
        { id: 2, title: "文章B", slug: "b", status: "draft", view_count: 0, created_at: "2026-07-23" },
        { id: 3, title: "新草稿C", slug: "c", status: "draft", view_count: 0, created_at: "2026-07-23" },
      ] });
    });

    // 已加载的文章正文不被列表（无 content）冲掉
    expect(result.current.state.blogPosts.find((p) => p.id === 1)?.content).toBe("正文A");
    expect(result.current.state.blogPosts.find((p) => p.id === 2)?.content).toBe("正文B");
    // 新建草稿随列表出现
    expect(result.current.state.blogPosts.find((p) => p.id === 3)?.title).toBe("新草稿C");
  });

  it("按 postId 隔离 patch 流，并忽略没有匹配 START 的增量", () => {
    const { result } = renderHook(() => useChat(), { wrapper });

    act(() => {
      result.current.dispatch({ type: "APPEND_BLOG_PATCH_STREAMING", payload: { postId: 1, runId: "missing", replacementDelta: "幽灵" } });
      result.current.dispatch({ type: "START_BLOG_PATCH_STREAMING", payload: { postId: 1, runId: "run-1", targetText: "旧一" } });
      result.current.dispatch({ type: "APPEND_BLOG_PATCH_STREAMING", payload: { postId: 1, runId: "run-1", replacementDelta: "新一" } });
      result.current.dispatch({ type: "START_BLOG_PATCH_STREAMING", payload: { postId: 2, runId: "run-2", targetText: "旧二" } });
      result.current.dispatch({ type: "APPEND_BLOG_PATCH_STREAMING", payload: { postId: 2, runId: "run-2", replacementDelta: "新二" } });
    });

    expect(result.current.state.blogPatchStreamingByPostId).toEqual({
      1: { runId: "run-1", targetText: "旧一", replacementDelta: "新一" },
      2: { runId: "run-2", targetText: "旧二", replacementDelta: "新二" },
    });

    act(() => {
      result.current.dispatch({ type: "START_BLOG_PATCH_STREAMING", payload: { postId: 1, runId: "run-new", targetText: "新目标" } });
      result.current.dispatch({ type: "CLEAR_BLOG_PATCH_STREAMING", payload: { postId: 1, runId: "run-1" } });
    });

    expect(result.current.state.blogPatchStreamingByPostId[1]).toEqual({
      runId: "run-new",
      targetText: "新目标",
      replacementDelta: "",
    });
  });

  it("登出时清除选区上下文和所有文章流", () => {
    const { result } = renderHook(() => useChat(), { wrapper });

    act(() => {
      result.current.dispatch({
        type: "SET_AI_SELECTION_CONTEXT",
        payload: { postId: 42, selectedText: "需要修改的原文", sectionIndex: 2 },
      });
      result.current.dispatch({ type: "START_BLOG_STREAMING", payload: { postId: 42, runId: "write" } });
      result.current.dispatch({ type: "START_BLOG_PATCH_STREAMING", payload: { postId: 42, runId: "patch", targetText: "需要修改的原文" } });
      result.current.dispatch({ type: "LOGOUT" });
    });

    expect(result.current.state.aiSelectionContext).toBeNull();
    expect(result.current.state.blogStreamingByPostId).toEqual({});
    expect(result.current.state.blogPatchStreamingByPostId).toEqual({});
  });
});
