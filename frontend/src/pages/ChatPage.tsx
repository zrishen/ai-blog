import { useEffect, useRef } from "react";
import { useChat } from "../stores/chatStore";
import { useChatHooks } from "../hooks/useChat";
import { ChatMessage } from "../components/ChatMessage";
import { ChatInput } from "../components/ChatInput";

export function ChatPage() {
  const { state } = useChat();
  const { loadConversations, loadMessages } = useChatHooks();
  const prevMessageCountRef = useRef(0);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (state.currentConversationId) {
      loadMessages(state.currentConversationId);
    }
  }, [state.currentConversationId, loadMessages]);

  // Auto scroll to bottom on new messages only
  useEffect(() => {
    if (state.messages.length !== prevMessageCountRef.current) {
      prevMessageCountRef.current = state.messages.length;
      const el = document.getElementById("chat-messages");
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [state.messages.length]);

  return (
    <div className="chat-page">
      <div className="chat-messages" id="chat-messages">
        {state.messages.length === 0 && !state.isStreaming ? (
          <div className="empty-state">
            <h2>AI Assistant</h2>
            <p>Start a new conversation or select one from the sidebar.</p>
          </div>
        ) : (
          state.messages.map((msg, idx) => (
            <ChatMessage key={msg.id} index={idx} content={msg.content} role={msg.role} imageUrl={msg.image_url} fileUrl={msg.file_url} tool_calls={msg.tool_calls} tool_results={msg.tool_results} />
          ))
        )}
      </div>
      <ChatInput />
    </div>
  );
}
