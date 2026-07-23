import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  deleteChatAttachment,
  uploadChatAttachment,
  type ChatAttachmentUploadRequest,
} from "../../../api/chatAttachments";
import { useChat } from "../../../stores/chatStore";
import type { AISidebarConversationKey, DraftAttachment } from "../types";

const MAX_CONCURRENT_UPLOADS = 3;

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "附件上传失败，请重试";
}

export function useChatAttachments(key: AISidebarConversationKey | null, enabled: boolean) {
  const { state, dispatch } = useChat();
  const drafts = useMemo(
    () => (key ? state.aiSidebarAttachmentsByKey[key] ?? [] : []),
    [key, state.aiSidebarAttachmentsByKey],
  );
  const draftsRef = useRef(drafts);
  const keyRef = useRef(key);
  const queueRef = useRef<Array<{ key: AISidebarConversationKey; draft: DraftAttachment }>>([]);
  const activeCountRef = useRef(0);
  const requestsRef = useRef(new Map<string, ChatAttachmentUploadRequest>());
  const cancelledRef = useRef(new Set<string>());
  const objectUrlsRef = useRef(new Map<string, string>());
  const pumpQueueRef = useRef<() => void>(() => {});
  const disposedRef = useRef(false);

  useEffect(() => {
    draftsRef.current = drafts;
    keyRef.current = key;
  }, [drafts, key]);

  useEffect(() => {
    const liveIds = new Set(drafts.map((draft) => draft.localId));
    for (const [localId, url] of objectUrlsRef.current) {
      if (liveIds.has(localId)) continue;
      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(localId);
    }
  }, [drafts]);

  useEffect(() => {
    disposedRef.current = false;
    const requests = requestsRef.current;
    const objectUrls = objectUrlsRef.current;
    return () => {
      disposedRef.current = true;
      queueRef.current = [];
      const activeKey = keyRef.current;
      if (activeKey) {
        const activeDrafts = draftsRef.current.filter(
          (draft) => draft.status === "queued" || draft.status === "uploading",
        );
        for (const draft of activeDrafts) {
          dispatch({
            type: "UPDATE_AI_SIDEBAR_ATTACHMENT_FOR_KEY",
            payload: {
              key: activeKey,
              localId: draft.localId,
              patch: { status: "failed", error: "附件上传已暂停，请重试" },
            },
          });
        }
      }
      for (const request of requests.values()) request.cancel();
      requests.clear();
      for (const url of objectUrls.values()) URL.revokeObjectURL(url);
      objectUrls.clear();
    };
  }, [dispatch]);

  const updateDraft = useCallback((draftKey: AISidebarConversationKey, localId: string, patch: Partial<DraftAttachment>) => {
    dispatch({
      type: "UPDATE_AI_SIDEBAR_ATTACHMENT_FOR_KEY",
      payload: { key: draftKey, localId, patch },
    });
  }, [dispatch]);

  const pumpQueue = useCallback(() => {
    if (disposedRef.current) return;
    while (activeCountRef.current < MAX_CONCURRENT_UPLOADS && queueRef.current.length > 0) {
      const job = queueRef.current.shift();
      if (disposedRef.current) return;
      if (!job || cancelledRef.current.has(job.draft.localId)) continue;
      const draft = job.draft;

      activeCountRef.current += 1;
      updateDraft(job.key, draft.localId, { status: "uploading", progress: 0, error: undefined });
      const request = uploadChatAttachment(draft.file, {
        attachmentId: draft.localId,
        draftKey: job.key,
        onProgress: (progress) => updateDraft(job.key, draft.localId, { progress }),
      });
      requestsRef.current.set(draft.localId, request);
      void request.promise
        .then((attachment) => {
          if (disposedRef.current || cancelledRef.current.has(draft.localId)) return;
          updateDraft(job.key, draft.localId, {
            attachment,
            status: "uploaded",
            progress: 100,
            error: undefined,
          });
        })
        .catch((error: unknown) => {
          if (disposedRef.current || (error instanceof Error && error.name === "AbortError")) return;
          if (!cancelledRef.current.has(draft.localId)) {
            updateDraft(job.key, draft.localId, {
              status: "failed",
              error: errorMessage(error),
            });
          }
        })
        .finally(() => {
          requestsRef.current.delete(draft.localId);
          activeCountRef.current = Math.max(0, activeCountRef.current - 1);
          if (!disposedRef.current) pumpQueueRef.current();
        });
    }
  }, [updateDraft]);

  useEffect(() => {
    pumpQueueRef.current = pumpQueue;
  }, [pumpQueue]);

  const addFiles = useCallback((files: FileList | File[]) => {
    if (disposedRef.current || !enabled || !key) return;
    const selected = Array.from(files);
    if (selected.length === 0) return;
    const startPosition = draftsRef.current.length;
    const additions: DraftAttachment[] = selected.map((file, index) => {
      const localId = makeId();
      if (isImageFile(file)) objectUrlsRef.current.set(localId, URL.createObjectURL(file));
      return {
        localId,
        file,
        status: "queued",
        progress: 0,
        position: startPosition + index,
      };
    });
    dispatch({ type: "ADD_AI_SIDEBAR_ATTACHMENTS_FOR_KEY", payload: { key, attachments: additions } });
    queueRef.current.push(...additions.map((draft) => ({ key, draft })));
    queueMicrotask(pumpQueue);
  }, [dispatch, enabled, key, pumpQueue]);

  const retry = useCallback((localId: string) => {
    if (!key) return;
    cancelledRef.current.delete(localId);
    const draft = draftsRef.current.find((item) => item.localId === localId);
    if (!draft) return;
    updateDraft(key, localId, { status: "queued", progress: 0, error: undefined });
    queueRef.current.push({ key, draft: { ...draft, status: "queued", progress: 0, error: undefined } });
    queueMicrotask(pumpQueue);
  }, [key, pumpQueue, updateDraft]);

  const remove = useCallback(async (localId: string) => {
    if (!key) return;
    cancelledRef.current.add(localId);
    requestsRef.current.get(localId)?.cancel();
    queueRef.current = queueRef.current.filter((job) => job.draft.localId !== localId);
    const draft = draftsRef.current.find((item) => item.localId === localId);
    dispatch({ type: "REMOVE_AI_SIDEBAR_ATTACHMENT_FOR_KEY", payload: { key, localId } });
    if (draft?.attachment?.id) {
      try {
        await deleteChatAttachment(draft.attachment.id);
      } catch {
        // 本地先移除；服务端 pending 附件由过期清理兜底。
      }
    }
  }, [dispatch, key]);

  const markSending = useCallback((localIds: string[]) => {
    if (!key) return;
    for (const localId of localIds) updateDraft(key, localId, { status: "sending" });
  }, [key, updateDraft]);

  const restoreUploaded = useCallback((localIds: string[], targetKey?: AISidebarConversationKey) => {
    const activeKey = targetKey ?? keyRef.current;
    if (!activeKey) return;
    for (const localId of localIds) updateDraft(activeKey, localId, { status: "uploaded" });
  }, [updateDraft]);

  const clear = useCallback((targetKey?: AISidebarConversationKey) => {
    const activeKey = targetKey ?? keyRef.current;
    if (!activeKey) return;
    dispatch({ type: "CLEAR_AI_SIDEBAR_ATTACHMENTS_FOR_KEY", payload: { key: activeKey } });
  }, [dispatch]);

  const getPreviewUrl = useCallback((localId: string) => objectUrlsRef.current.get(localId), []);

  return {
    drafts,
    addFiles,
    retry,
    remove,
    markSending,
    restoreUploaded,
    clear,
    getPreviewUrl,
    hasUploading: drafts.some((draft) => draft.status === "queued" || draft.status === "uploading"),
    hasFailed: drafts.some((draft) => draft.status === "failed"),
    uploaded: drafts.filter((draft) => draft.status === "uploaded" && draft.attachment),
  };
}
