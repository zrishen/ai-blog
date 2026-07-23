import React, { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "../../src/stores/authStore";
import { ChatProvider, useChat } from "../../src/stores/chatStore";
import { AISidebar } from "../../src/features/ai-chat/AISidebar";
import type { ChatAttachment } from "../../src/features/ai-chat/types";

// 复用范式 A：vi.hoisted 把 api/client 全部做成 vi.fn，mock 掉会引入副作用的子组件
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
const attachmentApi = vi.hoisted(() => ({
  uploadChatAttachment: vi.fn(),
  deleteChatAttachment: vi.fn(),
  getChatAttachmentBlob: vi.fn(),
}));

vi.mock("../../src/api/client", () => api);
vi.mock("../../src/api/chatAttachments", () => attachmentApi);
vi.mock("../../src/features/ai-chat/ai-sidebar/AISidebarHeader", () => ({
  AISidebarHeader: () => <div>侧栏标题</div>,
}));
vi.mock("../../src/features/ai-chat/ai-sidebar/ConversationListView", () => ({
  ConversationListView: () => <div>会话列表</div>,
}));
vi.mock("../../src/features/ai-chat/ai-sidebar/MessageList", () => ({
  MessageList: () => <div>消息列表</div>,
}));
vi.mock("../../src/features/auth/LoginDialog", () => ({
  LoginDialog: ({ open }: { open: boolean }) => open ? <div>登录弹窗</div> : null,
}));
// 同步化 patch delta player：push 立即 append、finish 立即 resolve，避免 rAF 时序让 blog 写入链测试 flaky
vi.mock("../../src/features/ai-chat/ai-sidebar/patchDeltaPlayer", () => ({
  createPatchDeltaPlayer: (append: (delta: string) => void) => ({
    push: (delta: string) => { append(delta); },
    open: () => {},
    finish: () => Promise.resolve(),
    cancel: () => {},
  }),
}));

let latestChat: ReturnType<typeof useChat> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let capturedOptions: any;
let settleRequest: (() => void) | null = null;
let latestAuthUser: { id: number; username: string } | null = null;

// 用固定 temp key，便于断言（makeTempKey 用 Date.now 随机）
const TEMP_KEY = "temp:handle-send-test" as const;

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
    dispatch({ type: "SET_AI_SIDEBAR_SELECTED_KEY", payload: TEMP_KEY });
    dispatch({ type: "SET_AI_SELECTION_CONTEXT", payload: { postId: 1, selectedText: "测试", sectionIndex: 0 } });
    dispatch({ type: "SET_AI_SIDEBAR_INPUT_FOR_KEY", payload: { key: TEMP_KEY, input: "你好" } });
  }, [dispatch]);
  return null;
}

function AuthAwareSidebar() {
  const { isAuthenticated, isInitializing } = useAuth();
  const mode = isInitializing ? "pending" : isAuthenticated ? "private" : "shared";
  return <AISidebar mode={mode} />;
}

function renderSidebar() {
  localStorage.setItem("ai-sidebar-session:v1:7", JSON.stringify({
    version: 1,
    view: "chat",
    target: { kind: "new" },
  }));
  return render(
    <MemoryRouter>
      <AuthProvider>
        <ChatProvider>
          <Seed />
          <AuthAwareSidebar />
        </ChatProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function sendOnce() {
  fireEvent.click(await screen.findByRole("button", { name: "发送消息" }));
  await waitFor(() => expect(api.sendChat).toHaveBeenCalledOnce());
}

describe("AISidebar handleSend 心脏分支", () => {
  beforeEach(() => {
    localStorage.clear();
    latestChat = null;
    latestAuthUser = null;
    capturedOptions = null;
    settleRequest = null;
    vi.clearAllMocks();
    // AuthProvider 挂载用 cookie 调 /auth/refresh 恢复登录态
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      typeof url === "string" && url.includes("/auth/refresh")
        ? new Response(JSON.stringify({ access_token: "access-test", user: { id: 7, username: "alice" } }), {
            status: 200, headers: { "Content-Type": "application/json" },
          })
        : new Response("{}", { status: 200 }),
    ));
    api.fetchConversations.mockResolvedValue({ conversations: [] });
    api.getMessages.mockResolvedValue([]);
    attachmentApi.deleteChatAttachment.mockResolvedValue(undefined);
    api.sendChat.mockImplementation((_text: string, _id: number | null, options: unknown) => {
      capturedOptions = options;
      return new Promise<void>((resolve, reject) => {
        settleRequest = resolve;
        // 监听 abort：handleStop 调 controller.abort() 时以 AbortError reject，触发 catch 写"已停止"
        const signal = (options as { signal?: AbortSignal }).signal;
        signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("未登录点击 MCP 服务时打开登录弹窗而不是 MCP 配置", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));

    renderSidebar();
    await user.click(await screen.findByRole("button", { name: "添加内容" }));
    await user.click(await screen.findByText("MCP 服务"));

    expect(await screen.findByText("登录弹窗")).toBeInTheDocument();
    expect(latestChat?.state.mcpModalOpen).toBe(false);
  });

  it("上传附件后发送 attachments，并让乐观用户消息携带附件", async () => {
    const uploaded: ChatAttachment = {
      id: "attachment-1",
      kind: "file",
      original_name: "资料.txt",
      mime_type: "text/plain",
      size_bytes: 4,
      status: "pending",
      position: 0,
      download_url: "/api/chat/attachments/attachment-1/content",
    };
    attachmentApi.uploadChatAttachment.mockImplementation(() => ({
      promise: Promise.resolve(uploaded),
      cancel: vi.fn(),
    }));

    renderSidebar();
    await waitFor(() => expect(latestAuthUser?.username).toBe("alice"));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "添加内容" }));
    const input = document.querySelector<HTMLInputElement>("#ai-sidebar-attachment-input")!;
    fireEvent.change(input, { target: { files: [new File(["test"], "资料.txt", { type: "text/plain" })] } });
    await waitFor(() => expect(screen.getByText("资料.txt")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("4 B")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Escape" });

    await sendOnce();
    expect(capturedOptions.attachments).toEqual([{ id: "attachment-1" }]);
    const optimisticUserMessage = latestChat!.state.aiSidebarMessagesByKey[TEMP_KEY]?.[0];
    expect(optimisticUserMessage?.attachments).toEqual([uploaded]);

    const attached = { ...uploaded, status: "attached" as const };
    await act(async () => {
      capturedOptions.callbacks.onRoundEnd({ round_id: 1, classification: "final", text: "已读取" });
      capturedOptions.callbacks.onDone({
        conversation_id: 42,
        message_id: 100,
        user_message_id: 99,
        attachments: [attached],
      });
      settleRequest?.();
    });
    const savedUserMessage = latestChat!.state.aiSidebarMessagesByKey["server:42"]?.[0];
    expect(savedUserMessage?.id).toBe(99);
    expect(savedUserMessage?.conversation_id).toBe(42);
    expect(savedUserMessage?.attachments).toEqual([attached]);
    expect(latestChat!.state.aiSidebarMessagesByKey["server:42"]?.[1].id).toBe(100);
  });

  it("P0-1 onDone 触发 temp→server key 迁移", async () => {
    renderSidebar();
    await waitFor(() => expect(latestAuthUser?.username).toBe("alice"));
    await sendOnce();

    // 流式 final + onDone 迁移到 server:42
    await act(async () => {
      capturedOptions.callbacks.onRoundEnd({ round_id: 1, classification: "final", text: "回复内容" });
      capturedOptions.callbacks.onDone({ conversation_id: 42, message_id: 100, user_message_id: 99 });
      settleRequest?.();
    });

    // 迁移完成：selectedKey 变 server:42，temp key 数据删除，server key 保留消息
    await waitFor(() => expect(latestChat!.state.aiSidebarSelectedKey).toBe("server:42"));
    expect(latestChat!.state.aiSidebarConversationId).toBe(42);
    expect(latestChat!.state.aiSidebarMessagesByKey[TEMP_KEY]).toBeUndefined();
    const serverMsgs = latestChat!.state.aiSidebarMessagesByKey["server:42"];
    expect(serverMsgs).toHaveLength(2);
    expect(serverMsgs?.[1].conversation_id).toBe(42);
    // 流式结束
    expect(latestChat!.state.aiSidebarStreamingByKey["server:42"]).toBe(false);
    // user-scoped localStorage 持久化
    expect(JSON.parse(localStorage.getItem("ai-sidebar-session:v1:7")!)).toEqual({
      version: 1,
      view: "chat",
      target: { kind: "server", conversationId: 42 },
    });
    // skipNextHistoryLoadRef：迁移后不重复拉历史
    expect(api.getMessages).not.toHaveBeenCalled();
  });

  it("P0-2 onRoundDelta 累积 + onRoundEnd(final) 写入 content", async () => {
    renderSidebar();
    await waitFor(() => expect(latestAuthUser?.username).toBe("alice"));
    await sendOnce();

    await act(async () => {
      capturedOptions.callbacks.onRoundDelta({ delta: "Hello" });
      capturedOptions.callbacks.onRoundDelta({ delta: " world" });
    });
    // 流式期间：streamingRound 累积，content 仍空
    await waitFor(() => {
      const msg = latestChat!.state.aiSidebarMessagesByKey[TEMP_KEY]?.[1];
      expect(msg?.streamingRound).toBe("Hello world");
    });

    await act(async () => {
      capturedOptions.callbacks.onRoundEnd({ round_id: 1, classification: "final", text: "Hello world" });
      capturedOptions.callbacks.onDone({ conversation_id: 42, message_id: 100, user_message_id: 99 });
      settleRequest?.();
    });

    await waitFor(() => {
      const msg = latestChat!.state.aiSidebarMessagesByKey["server:42"]?.[1];
      expect(msg?.content).toBe("Hello world");
      expect(msg?.streamFinalized).toBe(true);
      expect(msg?.streamingRound).toBe("");
    });
  });

  it("P0-4 onStreamError 写入错误并停止流式", async () => {
    renderSidebar();
    await waitFor(() => expect(latestAuthUser?.username).toBe("alice"));
    await sendOnce();

    await act(async () => {
      capturedOptions.callbacks.onRoundDelta({ delta: "半轮" });
      capturedOptions.callbacks.onStreamError({ message: "服务异常" });
      settleRequest?.();
    });

    // assistant 消息记录 streamError
    await waitFor(() => {
      const msg = latestChat!.state.aiSidebarMessagesByKey[TEMP_KEY]?.[1];
      expect(msg?.streamError).toBe("服务异常");
    });
    // 会话级错误 + 流式停止
    await waitFor(() => expect(latestChat!.state.aiSidebarErrorsByKey[TEMP_KEY]).toBe("服务异常"));
    expect(latestChat!.state.aiSidebarStreamingByKey[TEMP_KEY]).toBe(false);
  });

  it("P0-7 流式中发送按钮变为停止生成（UI 层防重入）", async () => {
    renderSidebar();
    await waitFor(() => expect(latestAuthUser?.username).toBe("alice"));
    await sendOnce();
    // 流式中 ChatInputBar 按钮变"停止生成"，发送按钮不再可点（UI 层防重入）
    await waitFor(() => expect(screen.getByRole("button", { name: "停止生成" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "发送消息" })).not.toBeInTheDocument();
    expect(api.sendChat).toHaveBeenCalledOnce();
  });

  it("P0-3 onRoundEnd(loop) 追加 loopSteps，onRoundEnd(discard) 清 streamingRound", async () => {
    renderSidebar();
    await waitFor(() => expect(latestAuthUser?.username).toBe("alice"));
    await sendOnce();

    // loop：清 streamingRound，追加 loopSteps
    await act(async () => {
      capturedOptions.callbacks.onRoundDelta({ delta: "进行中" });
      capturedOptions.callbacks.onRoundEnd({ round_id: 1, classification: "loop", text: "思考步骤A" });
    });
    await waitFor(() => {
      const msg = latestChat!.state.aiSidebarMessagesByKey[TEMP_KEY]?.[1];
      expect(msg?.loopSteps).toEqual(["思考步骤A"]);
      expect(msg?.streamingRound).toBe("");
    });

    // discard：清 streamingRound（loopSteps 保留）
    await act(async () => {
      capturedOptions.callbacks.onRoundDelta({ delta: "又被丢弃" });
      capturedOptions.callbacks.onRoundEnd({ round_id: 2, classification: "discard" });
    });
    await waitFor(() => {
      const msg = latestChat!.state.aiSidebarMessagesByKey[TEMP_KEY]?.[1];
      expect(msg?.streamingRound).toBe("");
      expect(msg?.loopSteps).toEqual(["思考步骤A"]);
    });
  });

  it("P0-5 handleStop abort → 写'已停止'并停止流式", async () => {
    renderSidebar();
    await waitFor(() => expect(latestAuthUser?.username).toBe("alice"));
    await sendOnce();
    // 流式中点停止生成 → controller.abort() → mock 以 AbortError reject → catch 写"已停止"
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    await waitFor(() => {
      const msg = latestChat!.state.aiSidebarMessagesByKey[TEMP_KEY]?.[1];
      expect(msg?.content).toBe("已停止");
    });
    expect(latestChat!.state.aiSidebarStreamingByKey[TEMP_KEY]).toBe(false);
  });

  it("P0-8 空 text 时 handleSend 直接返回，不调 sendChat", async () => {
    renderSidebar();
    await waitFor(() => expect(latestAuthUser?.username).toBe("alice"));
    // 清空输入（发送按钮会 disabled，改用 Enter 键触发 handleSend 以测函数守卫）
    act(() => {
      latestChat!.dispatch({ type: "SET_AI_SIDEBAR_INPUT_FOR_KEY", payload: { key: TEMP_KEY, input: "" } });
    });
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    await act(async () => { await Promise.resolve(); });
    expect(api.sendChat).not.toHaveBeenCalled();
  });

  it("P0-6 onBlogDelta 累积 blogStreaming，onToolResult(create) 后 CLEAR", async () => {
    api.listSitePosts.mockResolvedValue({ posts: [] });
    renderSidebar();
    await waitFor(() => expect(latestAuthUser?.username).toBe("alice"));
    await sendOnce();

    // onToolCall 占据 blog 流所有权 → onBlogDelta 创建 player 并累积
    await act(async () => {
      capturedOptions.callbacks.onToolCall("blog_create_post", { call_id: "c1", round_id: 1 });
      capturedOptions.callbacks.onBlogDelta("生成的博客片段");
    });
    await waitFor(() => expect(latestChat!.state.blogStreamingContent).toBe("生成的博客片段"));

    // onToolResult(create_post) → finishBlog + CLEAR_BLOG_STREAMING
    await act(async () => {
      capturedOptions.callbacks.onToolResult(
        "blog_create_post",
        "done",
        { operation: "create_post", post_id: 99 },
        [],
        { call_id: "c1", round_id: 1 },
      );
      capturedOptions.callbacks.onDone({ conversation_id: 42, message_id: 100, user_message_id: 99 });
      settleRequest?.();
    });
    await waitFor(() => expect(latestChat!.state.blogStreamingContent).toBeNull());
  });
});
