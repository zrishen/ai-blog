import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const Select = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<"select">
>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        "flex h-9 w-full appearance-none rounded-control border border-border/70 bg-background/72 px-3 py-1 pr-8 text-reading shadow-sm transition-[border-color,background-color,box-shadow] duration-200 focus-visible:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 md:text-body",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
  </div>
));
Select.displayName = "Select";

export { Select };
