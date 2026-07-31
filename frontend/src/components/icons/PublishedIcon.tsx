import publishedIcon from "@/components/icons/published.svg";
import { cn } from "@/lib/utils";

/** 已发布文章图标（published.svg 包装）：与 BlogIcon 用法一致，尺寸随 className */
export function PublishedIcon({ className }: { className?: string }) {
  return <img src={publishedIcon} alt="" aria-hidden className={cn("h-4 w-4", className)} />;
}
