import * as React from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** 顶部图标(传 lucide 图标组件,如 FileX)。会包在统一的圆环容器里 */
  icon?: React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
  /** 主标题 */
  title: React.ReactNode;
  /** 副描述 */
  description?: React.ReactNode;
  /** 操作区(通常放按钮) */
  action?: React.ReactNode;
  /** compact:面板内较小留白;default:页面/大面板主体空状态 */
  size?: "default" | "compact";
  variant?: "default" | "ai-chat";
}

/**
 * 居中型空状态:用于页面/面板主体没有内容时的占位。
 * 列表内单行左对齐的"暂无xxx"提示不适用本组件,继续用 <Surface variant="dashed">。
 */
const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  (
    { icon: Icon, title, description, action, size = "default", variant = "default", className, children, ...props },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center justify-center text-center",
        variant === "ai-chat" ? "gap-0 px-5 py-0" : size === "compact" ? "gap-2 px-4 py-6" : "gap-3 px-6 py-12",
        className,
      )}
      {...props}
    >
      {Icon ? (
        <div
          className={cn(
            "flex items-center justify-center rounded-panel bg-primary/10 text-primary ring-1 ring-primary/15",
            variant === "ai-chat" ? "mb-3 h-14 w-14" : size === "compact" ? "h-10 w-10" : "h-14 w-14",
          )}
        >
          <Icon className={variant === "ai-chat" || size !== "compact" ? "size-6" : "size-5"} aria-hidden />
        </div>
      ) : null}
      <div className={variant === "ai-chat" ? "space-y-0" : "space-y-1"}>
        <h3
          className={cn(
            "text-foreground",
            variant === "ai-chat" ? "text-reading font-black tracking-[-0.04em]" : size === "compact" ? "text-meta font-semibold" : "text-body font-semibold",
          )}
        >
          {title}
        </h3>
        {description ? (
          <p
            className={cn(
              "text-muted-foreground",
              variant === "ai-chat" ? "mt-2 max-w-[220px] text-meta leading-relaxed" : size === "compact" ? "text-fine" : "text-meta",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className={variant === "ai-chat" ? "mt-4" : size === "compact" ? "mt-1" : "mt-2"}>{action}</div> : null}
      {children}
    </div>
  ),
);
EmptyState.displayName = "EmptyState";

export { EmptyState };
