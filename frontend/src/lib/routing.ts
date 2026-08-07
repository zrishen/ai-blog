// 判定 location.state 里的回跳目标是否本源安全路径，防 open redirect：
// 协议相对(//host)、反斜杠(/\host，浏览器规范化为 //host) 等会被 URL 解析逃逸到外域。
// 对应 react-router 6.x GHSA-wrjc-x8rr-h8h6 的纵深防御——returnTo 来自内部 state 本不可控，
// 此处兜底未来若引入 URL → state 的入口。
export function isSafeInternalPath(path: unknown): path is string {
  if (typeof path !== "string" || !path.startsWith("/")) return false
  if (path.startsWith("//") || path.startsWith("\\")) return false
  try {
    return new URL(path, window.location.origin).origin === window.location.origin
  } catch {
    return false
  }
}
