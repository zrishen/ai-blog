import * as React from "react";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { surfaceVariants } from "@/lib/visualVariants";

export interface SurfaceProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof surfaceVariants> {}

const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(surfaceVariants({ variant }), className)}
      {...props}
    />
  ),
);
Surface.displayName = "Surface";

export interface SelectableSurfaceProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  variant?: "interactive" | "featured";
}

const SelectableSurface = React.forwardRef<HTMLButtonElement, SelectableSurfaceProps>(
  ({ className, selected = false, variant = "interactive", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        surfaceVariants({ variant: selected ? "selected" : variant }),
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-60",
        className,
      )}
      {...props}
    />
  ),
);
SelectableSurface.displayName = "SelectableSurface";

export { Surface, SelectableSurface };
