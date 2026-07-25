import * as React from "react";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { workspacePanelVariants } from "@/lib/visualVariants";

export interface WorkspacePanelProps
  extends React.ComponentPropsWithoutRef<"aside">,
    VariantProps<typeof workspacePanelVariants> {}

const WorkspacePanel = React.forwardRef<HTMLElement, WorkspacePanelProps>(
  ({ className, side, ...props }, ref) => (
    <aside
      ref={ref}
      className={cn(workspacePanelVariants({ side }), className)}
      {...props}
    />
  ),
);
WorkspacePanel.displayName = "WorkspacePanel";

export { WorkspacePanel };
