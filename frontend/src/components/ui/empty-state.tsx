import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** 顶部图标(传 lucide 图标组件,如 FileX)。会包在统一的圆环容器里 */
  icon?: LucideIcon;
  /** 主标题 */
  title: React.ReactNode;
  /** 副描述 */
  description?: React.ReactNode;
  /** 操作区(通常放按钮) */
  action?: React.ReactNode;
  /** compact:面板内较小留白;default:页面/大面板主体空状态 */
  size?: "default" | "compact";
}

/**
 * 居中型空状态:用于页面/面板主体没有内容时的占位。
 * 列表内单行左对齐的"暂无xxx"提示不适用本组件,继续用 <Surface variant="dashed">。
 */
const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  (
    { icon: Icon, title, description, action, size = "default", className, children, ...props },
    ref,
  ) => (
    <Surface
      ref={ref}
      variant="card"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "compact" ? "gap-2 rounded-control px-4 py-6" : "gap-3 rounded-panel px-6 py-12",
        className,
      )}
      {...props}
    >
      {Icon ? (
        <div
          className={cn(
            "flex items-center justify-center rounded-panel bg-primary/10 text-primary ring-1 ring-primary/15",
            size === "compact" ? "h-10 w-10" : "h-14 w-14",
          )}
        >
          <Icon className={size === "compact" ? "size-5" : "size-6"} aria-hidden />
        </div>
      ) : null}
      <div className="space-y-1">
        <p className={cn("font-semibold text-foreground", size === "compact" ? "text-sm" : "text-base")}>
          {title}
        </p>
        {description ? (
          <p className={cn("text-muted-foreground", size === "compact" ? "text-xs" : "text-sm")}>
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className={size === "compact" ? "mt-1" : "mt-2"}>{action}</div> : null}
      {children}
    </Surface>
  ),
);
EmptyState.displayName = "EmptyState";

export { EmptyState };
