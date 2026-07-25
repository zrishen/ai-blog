import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { surfaceVariants } from "@/lib/visualVariants";
import { cn } from "@/lib/utils";
import type { ResearchClaim, ResearchEntity } from "@/api/client";

function statusTone(status: string) {
  if (["supported", "approved", "applied"].includes(status)) return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (["conflicting", "rejected", "failed"].includes(status)) return "border-destructive/25 bg-destructive/10 text-destructive";
  return "border-primary/20 bg-primary/10 text-primary";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "待审核",
    supported: "已支持",
    conflicting: "有冲突",
    rejected: "已拒绝",
  };
  return labels[status] ?? status;
}

export function ClaimNode({ data, selected }: NodeProps) {
  const { claim, entities } = data as { claim: ResearchClaim; entities: ResearchEntity[] };

  return (
    <div
      className={cn(
        surfaceVariants({ variant: selected ? "selected" : "card" }),
        "w-[300px] rounded-[1.3rem] p-4 shadow-sm",
        !selected && "border-primary/20 bg-card/95",
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-primary" />
      <div className="mb-2 flex flex-wrap gap-1.5">
        <Badge variant="outline" className={`rounded-full text-[10px] ${statusTone(claim.status)}`}>{statusLabel(claim.status)}</Badge>
        <Badge variant="outline" className="rounded-full text-[10px]">置信度 {claim.confidence}%</Badge>
        {claim.adopted && <Badge variant="outline" className="rounded-full border-emerald-500/25 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300">已采用</Badge>}
      </div>
      <p className="line-clamp-4 text-sm font-semibold leading-relaxed text-foreground">{claim.claim_text}</p>
      {entities.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {entities.slice(0, 3).map((entity) => <Badge key={entity.id} variant="outline" className="rounded-full text-[10px]">{entity.name}</Badge>)}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-primary" />
    </div>
  );
}
