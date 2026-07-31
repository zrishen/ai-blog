import { cva } from "class-variance-authority";

export const surfaceVariants = cva(
  "border text-card-foreground transition-[background-color,border-color,box-shadow,transform] duration-200",
  {
    variants: {
      variant: {
        card: "rounded-surface border-border/70 bg-card/86 shadow-surface backdrop-blur-xl",
        inset: "rounded-panel border-border/60 bg-background/55 shadow-sm",
        interactive: "rounded-panel border-border/70 bg-card/86 shadow-surface hover:-translate-y-px hover:bg-card hover:shadow-surface-raised",
        selected: "rounded-panel border-border/80 bg-primary/6 shadow-sm shadow-foreground/5",
        featured: "rounded-surface border-border/70 bg-card/94 shadow-surface-raised",
        dashed: "rounded-panel border-dashed border-border/80 bg-background/45 text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "card",
    },
  },
);

export const navItemVariants = cva(
  "inline-flex items-center justify-center gap-2 text-body font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20",
  {
    variants: {
      layout: {
        top: "h-9 min-w-[92px] rounded-control px-4",
        side: "w-full justify-start rounded-control border px-3 py-2.5",
      },
      state: {
        active: "bg-primary/8 text-primary shadow-sm shadow-foreground/5",
        idle: "text-muted-foreground hover:bg-accent/55 hover:text-foreground",
      },
    },
    compoundVariants: [
      { layout: "side", state: "active", class: "border-border/80" },
      { layout: "side", state: "idle", class: "border-transparent" },
    ],
    defaultVariants: {
      layout: "top",
      state: "idle",
    },
  },
);

export const workspacePanelVariants = cva(
  "flex h-full w-full flex-col bg-card/82 backdrop-blur-xl",
  {
    variants: {
      side: {
        left: "border-r border-border/80 shadow-[12px_0_35px_hsl(var(--foreground)/0.03)]",
        right: "border-l border-border/80 shadow-[-12px_0_35px_hsl(var(--foreground)/0.04)]",
      },
    },
    defaultVariants: {
      side: "left",
    },
  },
);
