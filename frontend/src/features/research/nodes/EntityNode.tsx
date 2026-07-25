import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { surfaceVariants } from "@/lib/visualVariants";
import { cn } from "@/lib/utils";
import type { ResearchEntity } from "@/api/client";

function entityTypeLabel(type?: string | null) {
  const labels: Record<string, string> = {
    concept: "概念",
    technology: "技术",
    person: "人物",
    organization: "组织",
    product: "产品",
    method: "方法",
    claim_subject: "事实主体",
    other: "其他",
  };
  return labels[type ?? ""] ?? type ?? "实体";
}

export function EntityNode({ data, selected }: NodeProps) {
  const entity = (data as { entity: ResearchEntity }).entity;

  return (
    <div
      className={cn(
        surfaceVariants({ variant: selected ? "selected" : "card" }),
        "w-[220px] rounded-[1.4rem] p-4 shadow-sm",
        !selected && "border-emerald-500/25 bg-card/95",
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-emerald-500" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="line-clamp-2 text-sm font-black leading-snug text-foreground">{entity.name}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{entityTypeLabel(entity.entity_type)}</div>
        </div>
        <Badge variant="success" className="shrink-0 rounded-full text-[10px]">
          {entity.confidence}%
        </Badge>
      </div>
      {entity.description && <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{entity.description}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge variant="outline" className="rounded-full text-[10px]">{entity.status}</Badge>
        {entity.aliases_json?.slice(0, 2).map((alias) => <Badge key={alias} variant="outline" className="rounded-full text-[10px]">{alias}</Badge>)}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-emerald-500" />
    </div>
  );
}
