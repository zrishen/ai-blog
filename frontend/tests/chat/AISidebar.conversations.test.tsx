import React, { useEffect } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
// 会话管理聚焦 list 视图交互；chat 内容（MessageList/ChatInputBar）简化 mock
vi.mock("../../src/features/ai-chat/ai-sidebar/MessageList", () => ({ MessageList: () => <div>消息列表</div> }));
vi.mock("../../src/features/ai-chat/ai-sidebar/ChatInputBar", () => ({ ChatInputBar: () => <div>输入栏</div> }));
vi.mock("../../src/features/auth/LoginDialog", () => ({ LoginDialog: () => null }));

let latestChat: ReturnType<typeof useChat> | null = null;
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
    dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: true });
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
          <AISidebar mode="private" />
        </ChatProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("AISidebar 会话管理", () => {
  beforeEach(() => {
    localStorage.clear();
    latestChat = null;
    latestAuthUser = null;
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      typeof url === "string" && url.includes("/auth/refresh")
        ? new Response(JSON.stringify({ access_token: "access-test", user: { id: 7, username: "alice" } }), {
            status: 200, headers: { "Content-Type": "application/json" },
          })
        : new Response("{}", { status: 200 }),
    ));
    api.fetchConversations.mockResolvedValue({ conversations: [] });
    api.getMessages.mockResolvedValue([]);
    api.deleteConversation.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mount 时加载会话列表并渲染标题", async () => {
    api.fetchConversations.mockResolvedValue({
      conversations: [
        { id: 1, title: "会话 Alpha", created_at: "2026-01-01T00:00:00Z" },
        { id: 2, title: "会话 Beta", created_at: "2026-01-02T00:00:00Z" },
      ],
    });
    renderSidebar();
    await waitFor(() => expect(latestAuthUser?.username).toBe("alice"));
    await waitFor(() => expect(api.fetchConversations).toHaveBeenCalled());
    expect(await screen.findByText("会话 Alpha")).toBeInTheDocument();
    expect(screen.getByText("会话 Beta")).toBeInTheDocument();
  });

  it("点新对话切到 temp key + chat 视图（返回按钮出现）", async () => {
    renderSidebar();
    await waitFor(() => expect(latestAuthUser?.username).toBe("alice"));
    fireEvent.click(await screen.findByRole("button", { name: /新对话/ }));
    await waitFor(() => expect(latestChat!.state.aiSidebarSelectedKey).toMatch(/^temp:/));
    // chat 视图：头部出现"返回"按钮
    await waitFor(() => expect(screen.getByRole("button", { name: /返回/ })).toBeInTheDocument());
  });

  it("点会话项切到 server key 并加载历史", async () => {
    api.fetchConversations.mockResolvedValue({
      conversations: [{ id: 5, title: "会话 Gamma", created_at: "2026-01-03T00:00:00Z" }],
    });
    renderSidebar();
    const item = await screen.findByText("会话 Gamma");
    fireEvent.click(item);
    await waitFor(() => expect(latestChat!.state.aiSidebarSelectedKey).toBe("server:5"));
    await waitFor(() => expect(api.getMessages).toHaveBeenCalledWith(5));
  });

  it("删除会话走确认弹窗 → 调 deleteConversation + REMOVE 线程", async () => {
    api.fetchConversations.mockResolvedValue({
      conversations: [{ id: 5, title: "会话 Gamma", created_at: "2026-01-03T00:00:00Z" }],
    });
    renderSidebar();
    await screen.findByText("会话 Gamma");
    fireEvent.click(screen.getByTitle("删除对话"));
    const confirmBtn = await screen.findByRole("button", { name: "删除" });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(api.deleteConversation).toHaveBeenCalledWith(5));
    // REMOVE_AI_SIDEBAR_THREAD：线程数据清掉
    await waitFor(() => {
      expect(latestChat!.state.aiSidebarMessagesByKey["server:5"]).toBeUndefined();
    });
  });

  it("chat 视图点返回回到 list 视图（新对话按钮再现）", async () => {
    renderSidebar();
    await waitFor(() => expect(latestAuthUser?.username).toBe("alice"));
    fireEvent.click(await screen.findByRole("button", { name: /新对话/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /返回/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /返回/ }));
    // list 视图：chat 内容（MessageList mock）卸载即表示切回 list
    await waitFor(() => expect(screen.queryByText("消息列表")).not.toBeInTheDocument());
  });
});
