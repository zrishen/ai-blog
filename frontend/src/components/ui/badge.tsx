import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-control border px-2.5 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20",
  {
    variants: {
      variant: {
        default:
          "border-primary/15 bg-primary/10 text-primary shadow-sm shadow-primary/5",
        secondary:
          "border-border/60 bg-secondary/82 text-secondary-foreground",
        destructive:
          "border-destructive/20 bg-destructive/8 text-destructive shadow-sm shadow-destructive/5",
        success: "border-success/20 bg-success/10 text-success",
        warning: "border-warning/25 bg-warning/10 text-warning-foreground",
        outline: "border-border/70 bg-background/55 text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge }
