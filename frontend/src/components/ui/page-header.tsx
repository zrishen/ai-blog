import * as React from "react";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}

const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  ({ title, description, eyebrow, actions, className }, ref) => {
    return (
      <header
        ref={ref}
        className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}
      >
        <div className="space-y-1.5">
          {eyebrow ? <p className="text-fine font-semibold uppercase tracking-[0.18em] text-primary/75">{eyebrow}</p> : null}
          <h1 className="text-2xl font-semibold tracking-[-0.035em] text-foreground">{title}</h1>
          {description ? <p className="max-w-2xl text-meta leading-6 text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
    );
  }
);
PageHeader.displayName = "PageHeader";

export { PageHeader };
