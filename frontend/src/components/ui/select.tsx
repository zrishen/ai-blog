import * as React from "react";
import { cn } from "@/lib/utils";

const Select = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<"select">
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-9 w-full rounded-control border border-border/70 bg-background/72 px-3 py-1 text-base shadow-sm transition-[border-color,background-color,box-shadow] duration-200 focus-visible:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
      className,
    )}
    {...props}
  />
));
Select.displayName = "Select";

export { Select };
