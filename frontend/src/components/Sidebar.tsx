import { useChat, toggleTheme } from "../stores/chatStore";
import { useChatHooks } from "../hooks/useChat";
import { KnowledgeBase } from "./KnowledgeBase";
import { MCPConfig } from "./MCPConfig";
import "./Sidebar.css";

export function Sidebar() {
  const { state, dispatch } = useChat();
  const { createNewChat, selectConversation, removeConversation } = useChatHooks();

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <button className="new-chat-btn" onClick={createNewChat}>
          <span>+</span> New Chat
        </button>
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab${state.activePanel === "conversations" ? " active" : ""}`}
            onClick={() => dispatch({ type: "SET_ACTIVE_PANEL", payload: "conversations" })}
          >
            Chats
          </button>
          <button
            className={`sidebar-tab${state.activePanel === "knowledge" ? " active" : ""}`}
            onClick={() => dispatch({ type: "SET_ACTIVE_PANEL", payload: "knowledge" })}
          >
            KB
          </button>
          <button
            className={`sidebar-tab${state.activePanel === "mcp" ? " active" : ""}`}
            onClick={() => dispatch({ type: "SET_ACTIVE_PANEL", payload: "mcp" })}
          >
            MCP
          </button>
        </div>
        <button className="theme-toggle" onClick={() => toggleTheme(dispatch)} title="Toggle theme">
          {state.theme === "dark" ? "☀️" : "🌙"}
        </button>
      </div>
      {state.activePanel === "conversations" ? (
        <div className="conversation-list">
          {state.conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item${state.currentConversationId === conv.id ? " active" : ""}`}
              onClick={() => selectConversation(conv.id)}
            >
              <span className="conversation-item-title">{conv.title}</span>
              <button
                className="conversation-item-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  removeConversation(conv.id);
                }}
              >
                x
              </button>
            </div>
          ))}
        </div>
      ) : state.activePanel === "knowledge" ? (
        <KnowledgeBase />
      ) : (
        <MCPConfig />
      )}
      <div className="sidebar-footer">
        AI Assistant v0.1
      </div>
    </div>
  );
}
