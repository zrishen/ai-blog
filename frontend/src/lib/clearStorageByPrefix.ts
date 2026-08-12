/** 按前缀批量清除 localStorage 键（登出/清理场景，防本机残留与跨用户泄露）。 */
export function clearStorageByPrefix(prefix: string): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) toRemove.push(key);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}
