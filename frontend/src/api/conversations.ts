import { API_BASE, apiFetch, assertOk, parseJson } from "./client";

import type { Conversation, Message } from "@/types/chat";

export async function fetchConversations(): Promise<{ conversations: Conversation[] }> {
  const res = await apiFetch(`${API_BASE}/conversations`);
  await assertOk(res, "Failed to fetch conversations");
  return parseJson<{ conversations: Conversation[] }>(res);
}

export async function createConversation(title: string): Promise<Conversation> {
  const res = await apiFetch(`${API_BASE}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  await assertOk(res, "Failed to create conversation");
  return parseJson<Conversation>(res);
}

export async function deleteConversation(id: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/conversations/${id}`, { method: "DELETE" });
  await assertOk(res, "Failed to delete conversation");
}

export async function getMessages(conversationId: number): Promise<Message[]> {
  const res = await apiFetch(`${API_BASE}/conversations/${conversationId}/messages`);
  await assertOk(res, "Failed to fetch messages");
  return parseJson<Message[]>(res);
}
