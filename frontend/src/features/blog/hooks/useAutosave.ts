import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, createBlogPost, getAccessToken, updateBlogPost } from "../../../api/client";
import type { BlogPostData } from "../../../api/blog";
import { useAuth } from "../../../stores/authStore";
import { generateExcerpt } from "../utils/blogExcerpt";
import { draftRecoveryKey } from "../utils/draftStorage";
import { formatClock } from "@/lib/datetime";

export interface BlogWorkingCopy {
  title: string;
  content: string;
  tags: string;
  coverImage: string;
}

interface UseAutosaveOptions {
  postId?: number;
  values: BlogWorkingCopy;
  onCreated: (post: BlogPostData) => void;
  onSaved: (post: Pick<BlogPostData, "id" | "updated_at">) => void;
  onRecovered: (copy: BlogWorkingCopy) => void;
}

const AUTOSAVE_DELAY = 2000;

function serialize(copy: BlogWorkingCopy): string {
  return JSON.stringify({ ...copy, _savedAt: new Date().toISOString() });
}

function readRecoveryCopy(key: string): BlogWorkingCopy | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "") as Partial<BlogWorkingCopy>;
    if (typeof parsed.title !== "string" || typeof parsed.content !== "string") return null;
    return {
      title: parsed.title,
      content: parsed.content,
      tags: typeof parsed.tags === "string" ? parsed.tags : "",
      coverImage: typeof parsed.coverImage === "string" ? parsed.coverImage : "",
    };
  } catch {
    return null;
  }
}

/**
 * Persists the editable working copy.  Every write and explicit action can use
 * `enqueue`, so a slow autosave never races a publish, commit, or restore.
 */
export function useAutosave({ postId, values, onCreated, onSaved, onRecovered }: UseAutosaveOptions) {
  const { user } = useAuth();
  const userId = user?.id;
  const { title, content, tags, coverImage } = values;
  const latestRef = useRef(values);
  const versionRef = useRef(0);
  const postIdRef = useRef<number | undefined>(postId);
  const recoveredKeysRef = useRef(new Set<string>());
  const tailRef = useRef<Promise<unknown>>(Promise.resolve());
  const pausedRef = useRef(false);
  const [createdPostId, setCreatedPostId] = useState<number | undefined>();
  const [lastSaved, setLastSaved] = useState("");
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    latestRef.current = { title, content, tags, coverImage };
    versionRef.current += 1;
  }, [title, content, tags, coverImage]);

  useEffect(() => {
    if (postId != null) {
      postIdRef.current = postId;
    }
  }, [postId]);

  const writeRecoveryCopy = useCallback(() => {
    if (userId == null) return;
    const copy = latestRef.current;
    if (!copy.title.trim() && !copy.content.trim() && !copy.coverImage) return;
    // localStorage 禁用/超限（隐私模式、配额满）时 setItem 会抛：本地副本写不了就跳过，
    // 绝不能让它中断后续的远端保存。
    try {
      localStorage.setItem(draftRecoveryKey(userId, postIdRef.current), serialize(copy));
    } catch {
      /* 本地副本不可用，忽略 */
    }
  }, [userId]);

  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const next = tailRef.current.catch(() => undefined).then(operation);
    tailRef.current = next;
    return next;
  }, []);

  const persistLatest = useCallback(async (workingCopy?: BlogWorkingCopy): Promise<BlogPostData | null> => {
    const copy = workingCopy ?? latestRef.current;
    if (!copy.title.trim()) return null;
    const version = versionRef.current;
    const payload = {
      title: copy.title.trim(),
      content: copy.content,
      excerpt: generateExcerpt(copy.content),
      tags: copy.tags.trim() || undefined,
      cover_image: copy.coverImage || null,
    };
    let saved: BlogPostData;
    if (postIdRef.current == null) {
      saved = await createBlogPost({ ...payload, status: "draft" });
      // 本地副本迁移：localStorage 不可用时跳过，不影响已创建的远端记录
      try {
        const newKey = draftRecoveryKey(userId, saved.id);
        const oldKey = draftRecoveryKey(userId);
        const pendingCopy = localStorage.getItem(oldKey);
        if (pendingCopy) localStorage.setItem(newKey, pendingCopy);
        localStorage.removeItem(oldKey);
      } catch {
        /* ignore */
      }
      postIdRef.current = saved.id;
      setCreatedPostId(saved.id);
      onCreated(saved);
    } else {
      saved = await updateBlogPost(postIdRef.current, payload);
    }
    onSaved({ id: saved.id, updated_at: saved.updated_at });
    if (version === versionRef.current) {
      try {
        localStorage.removeItem(draftRecoveryKey(userId, saved.id));
      } catch {
        /* ignore */
      }
    }
    setLastSaved(formatClock(new Date()));
    setSaveError(false);
    return saved;
  }, [onCreated, onSaved, userId]);

  const flushNow = useCallback(
    (workingCopy?: BlogWorkingCopy) => enqueue(() => persistLatest(workingCopy)),
    [enqueue, persistLatest],
  );

  useEffect(() => {
    if (userId == null) return;
    const key = draftRecoveryKey(userId, postId);
    if (recoveredKeysRef.current.has(key)) return;
    recoveredKeysRef.current.add(key);
    const copy = readRecoveryCopy(key);
    if (copy) onRecovered(copy);
  }, [onRecovered, postId, userId]);

  useEffect(() => {
    const copy = latestRef.current;
    if (!copy.title.trim() && !copy.content.trim() && !copy.coverImage) return;
    const timer = window.setTimeout(() => {
      writeRecoveryCopy();
      if (pausedRef.current) return;
      void flushNow()
        .then(() => setSaveError(false))
        .catch(() => setSaveError(true));
    }, AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [title, content, tags, coverImage, flushNow, writeRecoveryCopy]);

  useEffect(() => {
    const onPageHide = () => {
      writeRecoveryCopy();
      const id = postIdRef.current;
      const copy = latestRef.current;
      if (id == null || !copy.title.trim()) return;
      const body = JSON.stringify({
        title: copy.title.trim(),
        content: copy.content,
        excerpt: generateExcerpt(copy.content),
        tags: copy.tags.trim() || undefined,
        cover_image: copy.coverImage || null,
      });
      // keepalive fetch 的 body 浏览器硬限 64KB（按 UTF-8 字节）。按字符串 length 会误判
      // 中文（1 code unit 但 UTF-8 3 字节）：超限的中文 body 仍会发送并被浏览器静默丢弃。
      if (new TextEncoder().encode(body).length > 60_000) return;
      const token = getAccessToken();
      void fetch(`${API_BASE}/blog/posts/${id}`, {
        method: "PUT",
        credentials: "include",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
      });
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [writeRecoveryCopy]);

  const pause = useCallback(() => { pausedRef.current = true; }, []);
  const resume = useCallback(() => { pausedRef.current = false; }, []);

  return { postId: postId ?? createdPostId, enqueue, flushNow, writeRecoveryCopy, lastSaved, saveError, pause, resume };
}
