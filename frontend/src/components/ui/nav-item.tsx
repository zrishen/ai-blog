import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import type { VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { navItemVariants } from "@/lib/visualVariants";

export interface NavItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof navItemVariants> {
  asChild?: boolean;
}

const NavItem = React.forwardRef<HTMLButtonElement, NavItemProps>(
  ({ className, layout, state, asChild = false, type = "button", ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        {...(!asChild ? { type } : {})}
        className={cn(navItemVariants({ layout, state }), className)}
        {...props}
      />
    );
  },
);
NavItem.displayName = "NavItem";

export { NavItem };
