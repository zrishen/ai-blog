import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, createBlogPost, getAccessToken, updateBlogPost } from "../../../api/client";
import type { BlogPostData } from "../../../api/blog";
import { generateExcerpt } from "../utils/blogExcerpt";

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

function recoveryKey(postId?: number): string {
  return postId == null ? "draft_blog_new" : `draft_blog_${postId}`;
}

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
  const { title, content, tags, coverImage } = values;
  const latestRef = useRef(values);
  const versionRef = useRef(0);
  const postIdRef = useRef<number | undefined>(postId);
  const recoveredKeysRef = useRef(new Set<string>());
  const tailRef = useRef<Promise<unknown>>(Promise.resolve());
  const pausedRef = useRef(false);
  const [createdPostId, setCreatedPostId] = useState<number | undefined>();
  const [lastSaved, setLastSaved] = useState("");

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
    const copy = latestRef.current;
    if (!copy.title.trim() && !copy.content.trim() && !copy.coverImage) return;
    localStorage.setItem(recoveryKey(postIdRef.current), serialize(copy));
  }, []);

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
      const newKey = recoveryKey(saved.id);
      const oldKey = recoveryKey();
      const pendingCopy = localStorage.getItem(oldKey);
      if (pendingCopy) localStorage.setItem(newKey, pendingCopy);
      localStorage.removeItem(oldKey);
      postIdRef.current = saved.id;
      setCreatedPostId(saved.id);
      onCreated(saved);
    } else {
      saved = await updateBlogPost(postIdRef.current, payload);
    }
    onSaved({ id: saved.id, updated_at: saved.updated_at });
    if (version === versionRef.current) {
      localStorage.removeItem(recoveryKey(saved.id));
    }
    setLastSaved(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
    return saved;
  }, [onCreated, onSaved]);

  const flushNow = useCallback(
    (workingCopy?: BlogWorkingCopy) => enqueue(() => persistLatest(workingCopy)),
    [enqueue, persistLatest],
  );

  useEffect(() => {
    const key = recoveryKey(postId);
    if (recoveredKeysRef.current.has(key)) return;
    recoveredKeysRef.current.add(key);
    const copy = readRecoveryCopy(key);
    if (copy) onRecovered(copy);
  }, [onRecovered, postId]);

  useEffect(() => {
    const copy = latestRef.current;
    if (!copy.title.trim() && !copy.content.trim() && !copy.coverImage) return;
    const timer = window.setTimeout(() => {
      writeRecoveryCopy();
      if (pausedRef.current) return;
      void flushNow().catch(() => {
        // Autosave failures are intentionally silent; the recovery copy stays local.
      });
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
      if (body.length > 60_000) return;
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

  return { postId: postId ?? createdPostId, enqueue, flushNow, writeRecoveryCopy, lastSaved, pause, resume };
}
