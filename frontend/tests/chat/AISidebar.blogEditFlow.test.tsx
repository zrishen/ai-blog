import React, { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "../../src/stores/authStore";
import { ChatProvider, useChat } from "../../src/stores/chatStore";
import { AISidebar } from "../../src/features/ai-chat/AISidebar";

const api = vi.hoisted(() => ({
  sendChat: vi.fn(),
  fetchConversations: vi.fn(),
  deleteConversation: vi.fn(),
  getMessages: vi.fn(),
  getBlogPost: vi.fn(),
  listSitePosts: vi.fn(),
  getResearchTopic: vi.fn(),
  runResearchTopic: vi.fn(),
  listResearchTopics: vi.fn(),
  createResearchTopic: vi.fn(),
  sendSharedLandingChat: vi.fn(),
  sendSharedUserChat: vi.fn(),
  getAccessToken: vi.fn(() => null),
  setAccessToken: vi.fn(),
}));

vi.mock("../../src/api/client", () => api);
vi.mock("../../src/features/ai-chat/ai-sidebar/AISidebarHeader", () => ({
  AISidebarHeader: () => <div>侧栏标题</div>,
}));
vi.mock("../../src/features/ai-chat/ai-sidebar/ConversationListView", () => ({
  ConversationListView: () => <div>会话列表</div>,
}));
vi.mock("../../src/features/ai-chat/ai-sidebar/MessageList", () => ({
  MessageList: () => <div>消息列表</div>,
}));
vi.mock("../../src/features/auth/LoginDialog", () => ({ LoginDialog: () => null }));

let latestChat: ReturnType<typeof useChat> | null = null;
let capturedOptions: any;
let settleRequest: (() => void) | null = null;
let rejectRequest: ((reason: Error) => void) | null = null;
let latestAuthUser: { id: number; username: string } | null = null;

function Seed() {
  const { state, dispatch } = useChat();
  const { user } = useAuth();
  useEffect(() => {
    latestChat = { state, dispatch };
  }, [dispatch, state]);
  useEffect(() => {
    latestAuthUser = user;
  }, [user]);
  useEffect(() => {
    const key = "temp:blog-edit" as const;
    dispatch({ type: "SET_AI_SIDEBAR_SELECTED_KEY", payload: key });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: 42 });
    dispatch({ type: "SET_BLOG_POSTS", payload: [{
      id: 42,
      title: "当前文章",
      slug: "current-post",
      content: "旧文本",
      status: "draft",
      view_count: 0,
      created_at: "2026-01-01T00:00:00Z",
    }] });
    dispatch({
      type: "SET_AI_SELECTION_CONTEXT",
      payload: { postId: 42, selectedText: "旧文本", sectionIndex: 2 },
    });
    dispatch({ type: "SET_AI_SIDEBAR_INPUT_FOR_KEY", payload: { key, input: "请润色得更简洁" } });
  }, [dispatch]);
  return null;
}

function renderSidebar() {
  localStorage.setItem("auth_token", "token");
  localStorage.setItem("auth_user", JSON.stringify({ id: 7, username: "alice" }));
  return render(
    <MemoryRouter>
      <AuthProvider>
        <ChatProvider>
          <Seed />
          <AISidebar mode="private" pageType="post" postTitle="当前文章" />
        </ChatProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("AISidebar 博客 AI 修改编排", () => {
  beforeEach(() => {
    localStorage.clear();
    latestChat = null;
    latestAuthUser = null;
    capturedOptions = null;
    settleRequest = null;
    rejectRequest = null;
    vi.clearAllMocks();
    // AuthProvider 挂载用 cookie 调 /auth/refresh 恢复登录态；模拟已登录 alice
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      typeof url === "string" && url.includes("/auth/refresh")
        ? new Response(JSON.stringify({ access_token: "access-test", user: { id: 7, username: "alice" } }), {
            status: 200, headers: { "Content-Type": "application/json" },
          })
        : new Response("{}", { status: 200 }),
    ));
    api.fetchConversations.mockResolvedValue({ conversations: [] });
    api.getMessages.mockResolvedValue({ messages: [] });
    api.getBlogPost.mockResolvedValue({
      id: 42,
      title: "当前文章",
      slug: "current-post",
      content: "新文本",
      status: "draft",
      view_count: 0,
      created_at: "2026-01-01T00:00:00Z",
    });
    api.sendChat.mockImplementation((_text: string, _id: number | null, options: unknown) => {
      capturedOptions = options;
      return new Promise<void>((resolve, reject) => {
        settleRequest = resolve;
        rejectRequest = reject;
      });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("将选区传给聊天请求，播放 patch 后刷新当前文章", async () => {
    renderSidebar();
    await waitFor(() => expect(latestChat?.state.aiSidebarSelectedKey).toBe("temp:blog-edit"));
    await waitFor(() => expect(latestAuthUser?.username).toBe("alice"));

    fireEvent.click(await screen.findByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(api.sendChat).toHaveBeenCalledOnce());

    expect(capturedOptions.context).toEqual(expect.objectContaining({
      page_type: "post",
      post_id: 42,
      post_title: "当前文章",
      selected_text: "旧文本",
      section_index: 2,
      trust_writing_enabled: false,
    }));
    expect(latestChat!.state.aiSelectionContext).toBeNull();

    await act(async () => {
      capturedOptions.callbacks.onToolCall("blog_edit_post", { call_id: "call-1", round_id: 1 });
      capturedOptions.callbacks.onPatchStart("旧文本");
      capturedOptions.callbacks.onPatchDelta("新文本");
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await waitFor(() => expect(latestChat!.state.blogPatchStreaming?.replacementDelta).toBe("新文本"));

    await act(async () => {
      capturedOptions.callbacks.onToolResult("blog_edit_post", "文章已精准修改", {
        operation: "edit_post",
        post_id: 42,
      }, [], { call_id: "call-1", round_id: 1 });
      settleRequest?.();
    });

    await waitFor(() => expect(latestChat!.state.blogPatchStreaming).toBeNull());
    await waitFor(() => expect(api.getBlogPost).toHaveBeenCalledWith(42));
    await waitFor(() => expect(latestChat!.state.blogPosts[0]?.content).toBe("新文本"));
    expect(latestChat!.state.aiSidebarStreamingByKey["temp:blog-edit"]).toBe(false);
    expect(latestChat!.state.aiSidebarMessagesByKey["temp:blog-edit"]?.[1]?.toolEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "start", toolName: "blog_edit_post", callId: "call-1" }),
      expect.objectContaining({ type: "end", toolName: "blog_edit_post", callId: "call-1" }),
    ]));
  });

  it("请求失败时取消补丁并停止当前会话，不刷新文章", async () => {
    renderSidebar();
    await waitFor(() => expect(latestAuthUser?.username).toBe("alice"));
    fireEvent.click(await screen.findByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(api.sendChat).toHaveBeenCalledOnce());

    await act(async () => {
      capturedOptions.callbacks.onPatchStart("旧文本");
      capturedOptions.callbacks.onPatchDelta("半截结果");
      rejectRequest?.(new Error("网络失败"));
    });

    await waitFor(() => expect(latestChat!.state.blogPatchStreaming).toBeNull());
    expect(api.getBlogPost).not.toHaveBeenCalled();
    expect(latestChat!.state.aiSidebarStreamingByKey["temp:blog-edit"]).toBe(false);
    expect(latestChat!.state.aiSidebarErrorsByKey["temp:blog-edit"]).toBe("无法获取回复，请稍后重试");
  });
});
