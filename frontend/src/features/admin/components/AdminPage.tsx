import type { PropsWithChildren, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";

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
  return <PageHeader title={title} description={description} eyebrow="Admin console" actions={actions} />;
}
