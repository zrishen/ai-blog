import type { ThinkingMode } from "../../api/chat";
import type { TrustChoiceOption } from "./trustPrompts";

export interface Reference {
  type: "rag" | "mcp";
  source?: string;
  collection?: string;
  distance?: number;
  server?: string;
  tool?: string;
}

export interface ToolEvent {
  type: "start" | "end";
  toolName: string;
  result?: string;
  references?: Reference[];
  callId?: string;
  roundId?: number;
  loopStepIndex?: number;
}

export type ChatAttachmentStatus = "pending" | "claimed" | "attached";

export interface ChatAttachment {
  id: string;
  kind: "image" | "file";
  original_name: string;
  mime_type: string;
  size_bytes: number;
  status: ChatAttachmentStatus;
  position?: number;
  download_url: string;
  preview_url?: string;
}

export type DraftAttachmentStatus = "queued" | "uploading" | "uploaded" | "sending" | "failed";

export interface DraftAttachment {
  localId: string;
  file: File;
  previewUrl?: string;
  attachment?: ChatAttachment;
  status: DraftAttachmentStatus;
  progress: number;
  error?: string;
  position: number;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  image_url?: string;
  file_url?: string;
  attachments?: ChatAttachment[];
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
  tool_results?: string[];
  thinkingContent?: string;
  streamingRound?: string;
  streamFinalized?: boolean;
  streamError?: string;
  toolEvents?: ToolEvent[];
  reasoningContent?: string;
  loopSteps?: string[];
  thinkingMode?: ThinkingMode;
  thinkingDurationMs?: number;
  trustChoicePrompt?: string | null;
  trustChoiceOptions?: TrustChoiceOption[];
  token_count: number;
  created_at: string;
}

export function isDisplayableMessage(message: unknown): message is Message {
  if (!message || typeof message !== "object") return false;
  const role = (message as { role?: unknown }).role;
  return role === "user" || role === "assistant";
}

export interface Conversation {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export type AISidebarConversationKey = `server:${number}` | `temp:${string}`;

export interface AISidebarHistoryState {
  loading: boolean;
  error: string | null;
}

export type AIStreamEvent =
  | { type: "delta"; delta: string }
  | { type: "loop"; content: string; roundId?: number; loopStepIndex?: number }
  | { type: "final"; content: string }
  | { type: "discard" }
  | { type: "error"; message: string };
