import { useCallback } from "react";
import { useChat } from "../stores/chatStore";
import {
  fetchConversations,
  createConversation,
  deleteConversation,
  getMessages,
  sendChat,
  uploadToKB,
  listKBDocuments,
  deleteKBDocument,
  listMCPServers,
  addMCPServer,
  deleteMCPServer,
} from "../api/client";

export function useChatHooks() {
  const { state, dispatch } = useChat();

  const loadConversations = useCallback(async () => {
    dispatch({ type: "SET_LOADING", payload: true });
    try {
      const data = await fetchConversations();
      dispatch({ type: "SET_CONVERSATIONS", payload: data.conversations });
    } catch (error) {
      console.error("Failed to load conversations:", error);
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  }, []);

  const loadMessages = useCallback(
    async (conversationId: number) => {
      dispatch({ type: "SET_LOADING", payload: true });
      try {
        const messages = await getMessages(conversationId);
        dispatch({ type: "SET_MESSAGES", payload: messages });
      } catch (error) {
        console.error("Failed to load messages:", error);
      } finally {
        dispatch({ type: "SET_LOADING", payload: false });
      }
    },
    [],
  );

  const createNewChat = useCallback(async () => {
    const data = await createConversation("New Chat");
    dispatch({ type: "SET_CONVERSATIONS", payload: [data, ...state.conversations] });
    dispatch({ type: "SET_CURRENT_CONVERSATION", payload: data.id });
    dispatch({ type: "SET_MESSAGES", payload: [] });
    return data.id;
  }, [state.conversations]);

  const selectConversation = useCallback(
    (id: number) => {
      dispatch({ type: "SET_CURRENT_CONVERSATION", payload: id });
      dispatch({ type: "SET_MESSAGES", payload: [] });
      loadMessages(id);
    },
    [loadMessages],
  );

  const removeConversation = useCallback(
    async (id: number) => {
      await deleteConversation(id);
      dispatch({
        type: "SET_CONVERSATIONS",
        payload: state.conversations.filter((c) => c.id !== id),
      });
      if (state.currentConversationId === id) {
        dispatch({ type: "SET_CURRENT_CONVERSATION", payload: null });
        dispatch({ type: "SET_MESSAGES", payload: [] });
      }
    },
    [state.conversations, state.currentConversationId],
  );

  const loadKBDocuments = useCallback(async () => {
    try {
      const data = await listKBDocuments();
      dispatch({ type: "SET_KB_DOCUMENTS", payload: data.documents });
    } catch (error) {
      console.error("Failed to load KB documents:", error);
    }
  }, []);

  const uploadToKnowledgeBase = useCallback(
    async (file: File) => {
      dispatch({ type: "SET_LOADING", payload: true });
      try {
        const doc = await uploadToKB(file);
        dispatch({ type: "SET_KB_DOCUMENTS", payload: [doc, ...state.kbDocuments] });
        await loadKBDocuments();
        return doc;
      } catch (error) {
        console.error("KB upload failed:", error);
        throw error;
      } finally {
        dispatch({ type: "SET_LOADING", payload: false });
      }
    },
    [state.kbDocuments, loadKBDocuments],
  );

  const removeKBDocument = useCallback(
    async (id: number) => {
      await deleteKBDocument(id);
      dispatch({ type: "REMOVE_KB_DOCUMENT", payload: id });
      await loadKBDocuments();
    },
    [loadKBDocuments],
  );

  const sendMessage = useCallback(
    async (content: string, image_url?: string, file_url?: string) => {
      const convId = state.currentConversationId;

      // Add user message
      const userMsg: any = {
        id: Date.now(),
        role: "user",
        content,
        image_url: image_url || undefined,
        file_url: file_url || undefined,
        conversation_id: convId,
        token_count: 0,
        created_at: new Date().toISOString(),
      };
      dispatch({ type: "ADD_MESSAGE", payload: userMsg as any });
      dispatch({ type: "SET_STREAMING", payload: true });

      // Create placeholder for assistant message
      const assistantMsgId = Date.now() + 1;
      const assistantMsg: any = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        conversation_id: convId,
        token_count: 0,
        created_at: new Date().toISOString(),
      };
      dispatch({ type: "ADD_MESSAGE", payload: assistantMsg as any });

      let currentConvId = convId;
      let assistantContent = "";

      try {
        await sendChat(
          content,
          convId,
          image_url,
          file_url,
          (chunk) => {
            assistantContent += chunk;
            dispatch({
              type: "UPDATE_MESSAGE",
              payload: { id: assistantMsgId, content: assistantContent },
            });
          },
          (metadata) => {
            currentConvId = metadata.conversation_id;
            dispatch({ type: "SET_CURRENT_CONVERSATION", payload: metadata.conversation_id });
          },
          (toolName) => {
            dispatch({
              type: "UPDATE_MESSAGE",
              payload: {
                id: assistantMsgId,
                tool_calls: [{ id: `tool-${Date.now()}`, name: toolName, arguments: "{}" }],
              },
            });
          },
          (toolName, result) => {
            dispatch({
              type: "UPDATE_MESSAGE",
              payload: {
                id: assistantMsgId,
                tool_calls: undefined,
                tool_results: [...(assistantMsg.tool_results || []), `${toolName}: ${result}`],
              },
            });
          },
        );
      } catch (error) {
        console.error("Chat error:", error);
        dispatch({
          type: "UPDATE_MESSAGE",
          payload: {
            id: assistantMsgId,
            content: "**Error: Failed to get response**",
          },
        });
      } finally {
        dispatch({ type: "SET_STREAMING", payload: false });
        loadConversations();
      }

      return currentConvId;
    },
    [state.currentConversationId, dispatch, loadConversations],
  );

  const loadMCPServers = useCallback(async () => {
    try {
      const data = await listMCPServers();
      dispatch({ type: "SET_MCP_SERVERS", payload: data.servers });
    } catch (error) {
      console.error("Failed to load MCP servers:", error);
    }
  }, []);

  const addMCPServer = useCallback(
    async (data: {
      name: string;
      server_type: string;
      command?: string;
      args?: string[];
      env_vars?: Record<string, string>;
      url?: string;
      tools?: string[];
    }) => {
      const server = await addMCPServer(data);
      dispatch({ type: "SET_MCP_SERVERS", payload: [...state.mcpServers, server] });
      return server;
    },
    [state.mcpServers],
  );

  const removeMCPServer = useCallback(
    async (id: number) => {
      await deleteMCPServer(id);
      dispatch({ type: "REMOVE_MCP_SERVER", payload: id });
    },
    [],
  );

  return {
    loadConversations,
    loadMessages,
    createNewChat,
    selectConversation,
    removeConversation,
    sendMessage,
    loadKBDocuments,
    uploadToKnowledgeBase,
    removeKBDocument,
    loadMCPServers,
    addMCPServer,
    removeMCPServer,
  };
}
