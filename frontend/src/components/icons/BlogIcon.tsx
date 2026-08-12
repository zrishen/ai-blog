import blogIcon from "@/components/icons/blog.svg";
import { cn } from "@/lib/utils";

const src: string = blogIcon as string;

/** 文章图标（blog.svg 包装）：兼容 lucide 用法——可作 icon prop 或直接渲染，尺寸随 className */
export function BlogIcon({ className }: { className?: string }) {
  return <img src={src} alt="" aria-hidden className={cn("h-4 w-4", className)} />;
}
