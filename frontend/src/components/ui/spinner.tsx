import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

// 统一加载指示器：固定 Loader2 + animate-spin，尺寸由调用方按场景传入。
function Spinner({ className, ...props }: React.ComponentProps<typeof Loader2>) {
  return <Loader2 className={cn("animate-spin", className)} {...props} />;
}

export { Spinner };
