import { cn } from "@/lib/utils";

// 骨架屏占位：animate-pulse + bg-muted，圆角/尺寸由调用方按场景传入。
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };
