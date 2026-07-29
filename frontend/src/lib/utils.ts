import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// 设计系统自定义圆角 token（rounded-surface/panel/control/shell）默认不被 tailwind-merge
// 识别为同一组，导致 Surface variant="card" 自带的 rounded-surface 无法被外部传入的
// rounded-control 等覆盖（两者共存，CSS 顺序让大的赢）。登记进 rounded 组后即可正确合并。
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      rounded: ["rounded-surface", "rounded-panel", "rounded-control", "rounded-shell"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
