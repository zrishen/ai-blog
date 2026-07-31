import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

type TabsVariant = "surface" | "underline"

const TabsVariantContext = React.createContext<TabsVariant>("surface")

function Tabs({ variant = "surface", ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> & { variant?: TabsVariant }) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.Root data-variant={variant} {...props} />
    </TabsVariantContext.Provider>
  )
}

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(TabsVariantContext)

  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        variant === "surface"
          ? "inline-flex h-10 items-center justify-center rounded-panel border border-border/60 bg-muted/65 p-1 text-muted-foreground"
          : "inline-flex h-auto w-full items-center justify-start gap-5 border-b border-border/70 bg-transparent p-0 text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(TabsVariantContext)

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        variant === "surface"
          ? "inline-flex items-center justify-center whitespace-nowrap rounded-control px-3 py-1.5 text-body font-medium transition-[background-color,color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card/92 data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:shadow-foreground/5"
          : "-mb-px inline-flex h-10 items-center justify-center whitespace-nowrap border-b-2 border-transparent px-1 text-body font-medium text-muted-foreground transition-[border-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-primary data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  )
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
