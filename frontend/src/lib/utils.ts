import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// 自定义圆角 token 默认不被 tailwind-merge 识别为同一组：默认圆角与外部传入的圆角共存时
// 按 CSS 顺序取大的生效，登记进 rounded 组后才可被正确覆盖。
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      rounded: ["rounded-surface", "rounded-panel", "rounded-control", "rounded-shell"],
      // 字号 token 登记进 font-size 组：否则与同元素的 text-{color} 判为同组冲突被删除，字号回退默认。
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
