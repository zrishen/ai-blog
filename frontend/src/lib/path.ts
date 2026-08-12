/** 返回路径的直接父目录；顶层路径返回 null。 */
export function parentPath(path: string): string | null {
  const index = path.lastIndexOf("/");
  return index < 0 ? null : path.slice(0, index);
}
