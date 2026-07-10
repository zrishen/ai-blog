import { useCallback } from "react";
import { useChat, type Message } from "../stores/chatStore";
import {
  fetchConversations,
  createConversation,
  deleteConversation,
  getMessages,
  sendChat,
  uploadToFileLibrary,
  listFileDocuments,
  deleteFileDocument,
  listMCPServers,
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
  }, [dispatch]);

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
    [dispatch],
  );

  const createNewChat = useCallback(async () => {
    const data = await createConversation("New Chat");
    dispatch({ type: "SET_CONVERSATIONS", payload: [data, ...state.conversations] });
    dispatch({ type: "SET_CURRENT_CONVERSATION", payload: data.id });
    dispatch({ type: "SET_MESSAGES", payload: [] });
    return data.id;
  }, [state.conversations, dispatch]);

  const selectConversation = useCallback(
    (id: number) => {
      dispatch({ type: "SET_CURRENT_CONVERSATION", payload: id });
      dispatch({ type: "SET_MESSAGES", payload: [] });
      loadMessages(id);
    },
    [loadMessages, dispatch],
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
    [state.conversations, state.currentConversationId, dispatch],
  );

  const loadFileDocuments = useCallback(async (categoryId?: number) => {
    try {
      const data = await listFileDocuments(categoryId);
      dispatch({ type: "SET_FILE_DOCUMENTS", payload: data.documents });
    } catch (error) {
      console.error("Failed to load file library documents:", error);
      throw error;
    }
  }, [dispatch]);

  const uploadToFileLibraryHook = useCallback(
    async (file: File, categoryId?: number) => {
      dispatch({ type: "SET_LOADING", payload: true });
      const targetCategoryId = categoryId ?? state.fileSelectedCategoryId ?? undefined;
      try {
        const doc = await uploadToFileLibrary(file, targetCategoryId);
        await loadFileDocuments(targetCategoryId);
        return doc;
      } catch (error) {
        console.error("File library upload failed:", error);
        throw error;
      } finally {
        dispatch({ type: "SET_LOADING", payload: false });
      }
    },
    [state.fileSelectedCategoryId, loadFileDocuments, dispatch],
  );

  const removeFileDocument = useCallback(
    async (id: number) => {
      await deleteFileDocument(id);
      dispatch({ type: "REMOVE_FILE_DOCUMENT", payload: id });
      await loadFileDocuments();
    },
    [loadFileDocuments, dispatch],
  );

  const sendMessage = useCallback(
    async (content: string, image_url?: string, file_url?: string) => {
      const convId = state.currentConversationId;

      // Add user message
      const userMsg: Message = {
        id: Date.now(),
        role: "user",
        content,
        image_url: image_url || undefined,
        file_url: file_url || undefined,
        conversation_id: convId ?? 0,
        token_count: 0,
        created_at: new Date().toISOString(),
      };
      dispatch({ type: "ADD_MESSAGE", payload: userMsg });
      dispatch({ type: "SET_STREAMING", payload: true });

      // Create placeholder for assistant message
      const assistantMsgId = Date.now() + 1;
      const assistantMsg: Message = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        conversation_id: convId ?? 0,
        token_count: 0,
        created_at: new Date().toISOString(),
      };
      dispatch({ type: "ADD_MESSAGE", payload: assistantMsg });

      let currentConvId = convId;
      let assistantContent = "";
      const toolResults: string[] = [];

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
            toolResults.push(`${toolName}: ${result}`);
            dispatch({
              type: "UPDATE_MESSAGE",
              payload: {
                id: assistantMsgId,
                tool_calls: undefined,
                tool_results: [...toolResults],
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
  }, [dispatch]);

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
      const { addMCPServer: addMCPServerAPI } = await import("../api/client");
      const server = await addMCPServerAPI(data);
      const refreshed = await listMCPServers();
      dispatch({ type: "SET_MCP_SERVERS", payload: refreshed.servers });
      return server;
    },
    [dispatch],
  );

  const removeMCPServer = useCallback(
    async (id: number) => {
      await deleteMCPServer(id);
      dispatch({ type: "REMOVE_MCP_SERVER", payload: id });
    },
    [dispatch],
  );

  return {
    loadConversations,
    loadMessages,
    createNewChat,
    selectConversation,
    removeConversation,
    sendMessage,
    loadFileDocuments,
    uploadToFileLibrary: uploadToFileLibraryHook,
    removeFileDocument,
    loadMCPServers,
    addMCPServer,
    removeMCPServer,
  };
}
