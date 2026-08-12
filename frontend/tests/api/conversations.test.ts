import { beforeEach, describe, expect, it, vi } from "vitest";

describe("api/conversations", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("fetchConversations 200 返回会话列表", async () => {
    const { setAccessToken } = await import("../../src/api/client");
    const { fetchConversations } = await import("../../src/api/conversations");
    setAccessToken("tok");
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ conversations: [{ id: 1 }, { id: 2 }] }), { status: 200 }),
    );
    const data = await fetchConversations();
    expect(data.conversations).toHaveLength(2);
  });

  it("fetchConversations 非 2xx 抛错", async () => {
    const { fetchConversations } = await import("../../src/api/conversations");
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    await expect(fetchConversations()).rejects.toThrow("Failed to fetch conversations");
  });

  it("createConversation POST 创建并返回", async () => {
    const { setAccessToken } = await import("../../src/api/client");
    const { createConversation } = await import("../../src/api/conversations");
    setAccessToken("tok");
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: 5, title: "新对话" }), { status: 200 }),
    );
    const data = await createConversation("新对话");
    expect(data.id).toBe(5);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).title).toBe("新对话");
  });

  it("deleteConversation DELETE 命中正确 URL 且无返回", async () => {
    const { setAccessToken } = await import("../../src/api/client");
    const { deleteConversation } = await import("../../src/api/conversations");
    setAccessToken("tok");
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await expect(deleteConversation(7)).resolves.toBeUndefined();
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/conversations/7");
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("DELETE");
  });

  it("getMessages 200 返回消息数组", async () => {
    const { setAccessToken } = await import("../../src/api/client");
    const { getMessages } = await import("../../src/api/conversations");
    setAccessToken("tok");
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ id: 1, role: "user" }, { id: 2, role: "assistant" }]), { status: 200 }),
    );
    const msgs = await getMessages(42);
    expect(msgs).toHaveLength(2);
  });
});
