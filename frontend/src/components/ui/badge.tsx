import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-control border px-2.5 py-0.5 text-fine font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20",
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
      // solid 维度:在彩色 variant 上叠加实心填充(用于状态确认等强提示场景)
      solid: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      {
        variant: "destructive",
        solid: true,
        class:
          "border-transparent bg-destructive text-destructive-foreground shadow-sm shadow-destructive/15",
      },
      {
        variant: "success",
        solid: true,
        class: "border-transparent bg-success text-white shadow-sm shadow-success/15",
      },
      {
        variant: "warning",
        solid: true,
        class:
          "border-transparent bg-warning text-warning-foreground shadow-sm shadow-warning/15",
      },
    ],
    defaultVariants: {
      variant: "default",
      solid: false,
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, solid, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(badgeVariants({ variant, solid }), className)}
      {...props}
    />
  )
)
Badge.displayName = "Badge"

export { Badge }
