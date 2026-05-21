import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChat } from "../stores/chatStore";
import "./ChatMessage.css";

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface ChatMessageProps {
  index: number;
  content: string;
  role: "user" | "assistant";
  imageUrl?: string;
  fileUrl?: string;
  tool_calls?: ToolCall[];
  tool_results?: string[];
}

export function ChatMessage({ index, content, role, imageUrl, fileUrl, tool_calls, tool_results }: ChatMessageProps) {
  const { state } = useChat();
  const isAssistant = role === "assistant";
  // Find the index of the last assistant message
  const lastAssistantIdx = state.messages
    .map((m, i) => (m.role === "assistant" ? i : -1))
    .filter((i) => i >= 0)
    .pop();
  const showCursor = isAssistant && state.isStreaming && lastAssistantIdx === index;

  const getFileName = (url?: string) => {
    if (!url) return "";
    return url.split("/").pop() || "";
  };

  return (
    <div className={`message ${role}`}>
      <div className="message-avatar">
        {role === "assistant" ? "AI" : "U"}
      </div>
      <div className="message-content">
        {imageUrl && (
          <div className="message-image">
            <img src={imageUrl} alt="Attached" />
          </div>
        )}
        {fileUrl && (
          <div className="message-file">
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="message-file-link">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span>{getFileName(fileUrl)}</span>
            </a>
          </div>
        )}
        {tool_calls && role === "assistant" && (
          <div className="message-tool-calls">
            {tool_calls.map((tc) => (
              <div key={tc.id} className="message-tool-call">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span>Calling: {tc.name}</span>
              </div>
            ))}
          </div>
        )}
        {tool_results && tool_results.length > 0 && (
          <div className="message-tool-results">
            {tool_results.map((tr, i) => {
              const colonIdx = tr.indexOf(":");
              const toolName = colonIdx !== -1 ? tr.substring(0, colonIdx).trim() : tr;
              const toolResult = colonIdx !== -1 ? tr.substring(colonIdx + 1).trim() : tr;
              return (
                <details key={i} className="message-tool-result">
                  <summary>Result from {toolName}</summary>
                  <div>{toolResult}</div>
                </details>
              );
            })}
          </div>
        )}
        <div className={`message-text${showCursor ? " typing-cursor" : ""}`}>
          <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
        </div>
      </div>
    </div>
  );
}
