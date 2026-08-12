export type ThinkingMode = "fast" | "balanced" | "smart";

export interface Reference {
  type: "rag" | "memory" | "mcp";
  source?: string;
  collection?: string;
  distance?: number;
  kind?: string;
  status?: string;
  time?: string;
  evidence?: string;
  path?: string;
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
  streamId?: string;
  status?: "preparing" | "running";
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

export function isChatAttachment(value: unknown): value is ChatAttachment {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && (item.kind === "image" || item.kind === "file")
    && typeof item.original_name === "string"
    && typeof item.mime_type === "string"
    && typeof item.size_bytes === "number"
    && (item.status === "pending" || item.status === "claimed" || item.status === "attached")
    && typeof item.download_url === "string";
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
  token_count: number;
  created_at: string;
}

export type MessageUpdatePatch = Partial<
  Pick<
    Message,
    | "content"
    | "conversation_id"
    | "attachments"
    | "thinkingContent"
    | "streamingRound"
    | "streamFinalized"
    | "streamError"
    | "toolEvents"
    | "reasoningContent"
    | "loopSteps"
    | "thinkingMode"
    | "thinkingDurationMs"
  >
>;

export function isDisplayableMessage(message: unknown): message is Message {
  if (!message || typeof message !== "object") return false;
  const value = message as Record<string, unknown>;
  return (value.role === "user" || value.role === "assistant")
    && typeof value.id === "number"
    && typeof value.content === "string"
    && typeof value.conversation_id === "number"
    && typeof value.created_at === "string";
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
