import type { ReactNode, SVGProps } from "react";
import { cn } from "@/lib/utils";

interface BaseIconProps extends SVGProps<SVGSVGElement> {
  children: ReactNode;
}

/**
 * 自定义线性图标共用底座，对齐 lucide-react 视觉与用法：
 * - 24×24 画布、2px 圆角描边
 * - stroke/fill 走 currentColor，颜色由外部 text-* 语义 token 控制（设计守门禁 hex/调色板色）
 * - 默认 h-4 w-4（16px），外部 className 可覆盖尺寸/颜色
 * - 透传原生 SVG 属性（onClick、style、data-* 等）
 */
export function BaseIcon({ className, children, ...props }: BaseIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("h-4 w-4", className)}
      {...props}
    >
      {children}
    </svg>
  );
}
