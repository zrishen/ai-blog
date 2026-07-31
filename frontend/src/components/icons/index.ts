// 自定义 SVG 图标
// ─ 线性图标统一走 BaseIcon（24×24、stroke=currentColor、2px 圆角描边），颜色靠外部
//   text-* 语义 token，尺寸靠 h-4 w-4 等档，与 lucide-react 用法一致。
// ─ 新增图标：建 XxxIcon.tsx，把 <path> 套进 <BaseIcon>，再在此处 re-export。
// ─ 设计守门：组件内禁 hex/调色板色；如确需「颜色承载语义」（如文件类型编码），
//   需在 scripts/check-design-system.mjs 的 colorPaletteAllowlist 增列白名单。
export { BaseIcon } from "./BaseIcon";
export { BlogIcon } from "./BlogIcon";
export { PublishedIcon } from "./PublishedIcon";
