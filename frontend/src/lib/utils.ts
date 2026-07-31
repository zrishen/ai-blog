import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// 设计系统自定义圆角 token（rounded-surface/panel/control/shell）默认不被 tailwind-merge
// 识别为同一组，导致 Surface variant="card" 自带的 rounded-surface 无法被外部传入的
// rounded-control 等覆盖（两者共存，CSS 顺序让大的赢）。登记进 rounded 组后即可正确合并。
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      rounded: ["rounded-surface", "rounded-panel", "rounded-control", "rounded-shell"],
      // 自定义字号 token（text-caption/fine/meta/body/body-lg/reading）登记进 font-size 组：
      // tailwind-merge 默认只认 text-sm/lg 等标准档与 text-[Npx]，自定义 token 不被识别为字号，
      // 会与同元素的 text-{color}（如 text-primary / text-muted-foreground）判为同组冲突而被删除，
      // 导致元素丢失字号类、回退继承到 html 默认 16px（视觉变大）。登记后字号与颜色分属不同组，共存不冲突。
      "font-size": [
        "text-caption",
        "text-fine",
        "text-meta",
        "text-body-lg",
        "text-body",
        "text-reading",
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
