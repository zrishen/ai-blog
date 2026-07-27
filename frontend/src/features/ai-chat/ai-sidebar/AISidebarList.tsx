import { useCallback, useMemo, useState } from "react";
import { useAuth } from "../../../stores/authStore";
import { useChat } from "../../../stores/chatStore";
import type { AISidebarConversationKey } from "../../../stores/chatStore";
import { deleteConversation } from "../../../api/client";
import { ConversationListView, type ConversationListItem } from "./ConversationListView";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAISidebarRuntime } from "./AISidebarRuntimeContext";
import { saveAISidebarSession } from "./constants";

const SHARED_CONVERSATION_KEY: AISidebarConversationKey = "temp:shared";

function makeServerKey(conversationId: number): AISidebarConversationKey {
  return `server:${conversationId}`;
}

// 会话列表子组件：消费运行时 Context + 自取 store；持有 deleteTarget / conversationItems / 3 list handler。
// DeleteDialog 随 list 下沉（deleteTarget 唯一 setter 在此）。从 AISidebar 抽出，行为不变。
export function AISidebarList() {
  const { user } = useAuth();
  const { state, dispatch } = useChat();
  const {
    isPrivate,
    conversations,
    loadConvs,
    setSidebarView,
    scrollToLatestAfterRender,
    abortControllersRef,
    runRefs,
    setHistoryReloadKey,
  } = useAISidebarRuntime();
  const [deleteTarget, setDeleteTarget] = useState<{ key: AISidebarConversationKey; id: number | null } | null>(null);

  const conversationItems = useMemo<ConversationListItem[]>(() => {
    const remoteItems = conversations.map((conv) => {
      const key = makeServerKey(conv.id);
      return {
        key,
        id: conv.id,
        title: conv.title,
        created_at: conv.created_at,
        selected: state.aiSidebarSelectedKey === key,
        streaming: !!state.aiSidebarStreamingByKey[key],
        error: state.aiSidebarErrorsByKey[key] ?? null,
        isTemp: false,
      };
    });
    const remoteKeys = new Set(remoteItems.map((item) => item.key));
    const tempItems = Object.entries(state.aiSidebarMessagesByKey)
      .filter(([key]) => key.startsWith("temp:") && key !== SHARED_CONVERSATION_KEY && !remoteKeys.has(key as AISidebarConversationKey))
      .map(([key, messages]) => {
        const typedKey = key as AISidebarConversationKey;
        const firstUser = messages.find((m) => m.role === "user");
        return {
          key: typedKey,
          id: null,
          title: firstUser?.content?.slice(0, 50) || "新对话",
          created_at: messages[0]?.created_at ?? new Date().toISOString(),
          selected: state.aiSidebarSelectedKey === typedKey,
          streaming: !!state.aiSidebarStreamingByKey[typedKey],
          error: state.aiSidebarErrorsByKey[typedKey] ?? null,
          isTemp: true,
        };
      })
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    return [...tempItems, ...remoteItems];
  }, [conversations, state.aiSidebarErrorsByKey, state.aiSidebarMessagesByKey, state.aiSidebarSelectedKey, state.aiSidebarStreamingByKey]);

  const handleSelectConversation = useCallback((item: ConversationListItem) => {
    if (!isPrivate || !user) return;
    saveAISidebarSession(
      user.id,
      item.id
        ? { version: 1, view: "chat", target: { kind: "server", conversationId: item.id } }
        : { version: 1, view: "chat", target: { kind: "new" } },
    );
    dispatch({ type: "SET_AI_SIDEBAR_SELECTED_KEY", payload: item.key });
    dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key: item.key, error: null } });
    if (item.id && state.aiSidebarSelectedKey === item.key) setHistoryReloadKey((key) => key + 1);
    scrollToLatestAfterRender(item.key);
    setSidebarView("chat");
  }, [isPrivate, user, dispatch, state.aiSidebarSelectedKey, setHistoryReloadKey, scrollToLatestAfterRender, setSidebarView]);

  const handleDeleteConversation = useCallback((item: ConversationListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isPrivate) return;
    setDeleteTarget({ key: item.key, id: item.id ?? null });
  }, [isPrivate]);

  const confirmDeleteConversation = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    abortControllersRef.current.get(target.key)?.abort();
    abortControllersRef.current.delete(target.key);
    runRefs.current.delete(target.key);
    dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key: target.key, error: null } });
    try {
      if (target.id != null) await deleteConversation(target.id);
      dispatch({ type: "REMOVE_AI_SIDEBAR_THREAD", payload: { key: target.key } });
      if (state.aiSidebarSelectedKey === target.key) {
        if (user) saveAISidebarSession(user.id, { version: 1, view: "list" });
        setSidebarView("list");
      }
      await loadConvs();
    } catch {
      dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key: target.key, error: "删除对话失败，请稍后重试" } });
    }
  }, [deleteTarget, dispatch, loadConvs, state.aiSidebarSelectedKey, abortControllersRef, runRefs, setSidebarView, user]);

  return (
    <>
      <ConversationListView
        conversations={conversationItems}
        error={conversationItems.find((item) => item.error)?.error ?? null}
        onSelect={handleSelectConversation}
        onDeleteRequest={handleDeleteConversation}
        onDismissError={() => {
          conversationItems.forEach((item) => {
            if (item.error) dispatch({ type: "SET_AI_SIDEBAR_ERROR_FOR_KEY", payload: { key: item.key, error: null } });
          });
        }}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-[340px] p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b border-border">
            <DialogTitle className="text-body">确认删除</DialogTitle>
            <DialogDescription className="text-fine">删除后可在回收站恢复。</DialogDescription>
          </DialogHeader>
          <DialogFooter className="px-4 py-3 gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button size="sm" variant="destructive" onClick={confirmDeleteConversation}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
