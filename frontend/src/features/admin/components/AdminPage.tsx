import type { PropsWithChildren, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const ADMIN_DIALOG_CLASS =
  "rounded-[1.6rem] border-border/70 bg-card/95 shadow-2xl shadow-foreground/10 backdrop-blur-xl";

export function AdminPage({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div className="h-full min-h-0 overflow-y-auto bg-gradient-to-br from-primary/5 via-transparent to-background/30">
      <div
        data-testid="admin-page-content"
        className={cn(
          "w-full space-y-6 p-2",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/75">
          Admin console
        </p>
        <h1 className="text-2xl font-semibold tracking-[-0.035em] text-foreground">
          {title}
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}
