import { Handle, Position, type NodeProps } from "@xyflow/react";

import { entityTypeColor } from "../utils/brainStyle";

import type { BrainGraphNode } from "@/api/brain";

import { Badge } from "@/components/ui/badge";
import { surfaceVariants } from "@/lib/visualVariants";
import { cn } from "@/lib/utils";

export function BrainEntityNode({ data, selected }: NodeProps) {
  const entity = (data as { entity: BrainGraphNode }).entity;
  const accent = entityTypeColor(entity.entity_type);

  return (
    <div
      className={cn(
        surfaceVariants({ variant: selected ? "selected" : "card" }),
        "w-[180px] rounded-panel p-3 shadow-sm",
        !selected && "bg-card/95",
      )}
      style={{ borderColor: selected ? accent : undefined }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2" style={{ background: accent }} />
      <div className="flex items-start gap-2">
        <span
          className="mt-1 h-2 w-2 shrink-0 rounded-full"
          style={{ background: accent }}
          aria-hidden
        />
        <div className="line-clamp-2 text-meta font-black leading-snug text-foreground">{entity.name}</div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {entity.entity_type && (
          <Badge variant="outline" className="rounded-full text-caption">{entity.entity_type}</Badge>
        )}
        <Badge variant="secondary" className="rounded-full text-caption">
          {Math.round(entity.confidence * 100)}%
        </Badge>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2" style={{ background: accent }} />
    </div>
  );
}
