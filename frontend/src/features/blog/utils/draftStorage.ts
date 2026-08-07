// 博客草稿本地恢复副本的存储 key 与清理工具。
// key 按 userId 隔离，避免同机多用户互相恢复出对方草稿；登出时统一清掉所有副本，防本机残留。
const DRAFT_PREFIX = "draft_blog_";

export function draftRecoveryKey(userId: number | undefined, postId?: number): string {
  const uid = userId == null ? "anon" : String(userId);
  return `${DRAFT_PREFIX}${uid}_${postId == null ? "new" : postId}`;
}

/** 登出时清掉所有用户的草稿本地副本（防本机残留 / 跨用户泄露）。 */
export function clearAllDraftRecovery(): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(DRAFT_PREFIX)) toRemove.push(key);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}
