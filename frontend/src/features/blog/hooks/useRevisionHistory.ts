import { useCallback, useEffect, useRef, useState } from "react";

import type { BlogPostData, BlogRevision, BlogRevisionSummary } from "@/api/blog";

import { commitBlogRevision, deleteBlogRevision, getBlogRevision, listBlogRevisions, restoreBlogRevision } from "@/api/blog";

/** Revision APIs are deliberately scoped to the article being edited. */
export function useRevisionHistory(postId?: number) {
  const [revisions, setRevisions] = useState<BlogRevisionSummary[]>([]);
  const [selected, setSelected] = useState<BlogRevision | null>(null);
  const [loading, setLoading] = useState(false);
  const detailCacheRef = useRef(new Map<number, BlogRevision>());
  const selectionRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (postId == null) {
      setRevisions([]);
      setSelected(null);
      detailCacheRef.current.clear();
      return [];
    }
    setSelected(null);
    detailCacheRef.current.clear();
    selectionRequestRef.current += 1;
    setLoading(true);
    try {
      const fetchedRevisions = await listBlogRevisions(postId);
      setRevisions(fetchedRevisions);
      return fetchedRevisions;
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => setRevisions([]));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const selectRevision = useCallback(async (revisionId: number) => {
    if (postId == null) return null;
    if (selected?.id === revisionId) return selected;

    const cached = detailCacheRef.current.get(revisionId);
    if (cached) {
      setSelected(cached);
      return cached;
    }

    const requestId = ++selectionRequestRef.current;
    setLoading(true);
    try {
      const detail = await getBlogRevision(postId, revisionId);
      detailCacheRef.current.set(revisionId, detail);
      if (selectionRequestRef.current === requestId) setSelected(detail);
      return detail;
    } finally {
      if (selectionRequestRef.current === requestId) setLoading(false);
    }
  }, [postId, selected]);

  const commit = useCallback(async (postIdOverride?: number) => {
    const targetPostId = postIdOverride ?? postId;
    if (targetPostId == null) throw new Error("Save the article before creating a revision");
    const revision = await commitBlogRevision(targetPostId);
    if (targetPostId === postId) await refresh();
    setSelected(revision);
    return revision;
  }, [postId, refresh]);

  const restore = useCallback(async (revisionId: number): Promise<BlogPostData> => {
    if (postId == null) throw new Error("Article not found");
    const post = await restoreBlogRevision(postId, revisionId);
    await refresh();
    return post;
  }, [postId, refresh]);

  const remove = useCallback(async (revisionId: number) => {
    if (postId == null) throw new Error("Article not found");
    await deleteBlogRevision(postId, revisionId);
    if (selected?.id === revisionId) setSelected(null);
    await refresh();
  }, [postId, refresh, selected?.id]);

  return { revisions, selected, loading, refresh, selectRevision, commit, restore, remove };
}
