import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SectionTitleProps {
  children: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
  /** 标题字号,对应原 display 标题的 text-* */
  size?: "3xl" | "2xl" | "xl" | "lg" | "base" | "sm";
  /** 渲染的标题标签,默认 h2 */
  as?: "h1" | "h2" | "h3";
}

const sizeClass = {
  "3xl": "text-3xl",
  "2xl": "text-2xl",
  xl: "text-xl",
  lg: "text-lg",
  base: "text-base",
  sm: "text-sm",
} as const;

/**
 * 区块级 display 标题:统一 font-black + tracking 收紧的标题样式。
 * 用于面板/卡片内的 h2/h3;页面级带描述/操作的标题用 PageHeader。
 * 直接渲染标题元素(不套 wrapper),替换 <h2 className="text-xl font-black tracking-..."> 不改变 DOM 结构。
 */
const SectionTitle = React.forwardRef<HTMLHeadingElement, SectionTitleProps>(
  ({ children, icon: Icon, className, size = "xl", as: Tag = "h2" }, ref) => (
    <Tag
      ref={ref}
      className={cn(
        "font-black tracking-[-0.03em] text-foreground",
        sizeClass[size],
        className,
      )}
    >
      {Icon ? <Icon className="mr-2 inline size-[1.05em] align-[-0.14em]" aria-hidden /> : null}
      {children}
    </Tag>
  ),
);
SectionTitle.displayName = "SectionTitle";

export { SectionTitle };
