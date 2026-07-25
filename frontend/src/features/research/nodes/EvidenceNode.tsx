import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { surfaceVariants } from "@/lib/visualVariants";
import { cn } from "@/lib/utils";
import type { ResearchEvidence, ResearchSource } from "@/api/client";

export function EvidenceNode({ data, selected }: NodeProps) {
  const { evidence, source } = data as { evidence: ResearchEvidence; source: ResearchSource | null };

  return (
    <div
      className={cn(
        surfaceVariants({ variant: selected ? "selected" : "card" }),
        "w-[260px] rounded-[1.2rem] p-4 shadow-sm",
        !selected && "border-sky-500/25 bg-card/95",
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-sky-500" />
      <div className="mb-2 flex flex-wrap gap-1.5">
        <Badge variant="outline" className="rounded-full border-sky-500/25 bg-sky-500/10 text-[10px] text-sky-700 dark:text-sky-300">{evidence.kind}</Badge>
        {evidence.location && <Badge variant="outline" className="rounded-full text-[10px]">{evidence.location}</Badge>}
      </div>
      <p className="line-clamp-4 text-xs font-semibold leading-relaxed text-foreground">“{evidence.quote}”</p>
      {source && <div className="mt-3 line-clamp-1 text-[11px] text-muted-foreground">来源：{source.title}</div>}
      <Handle type="source" position={Position.Right} className="!bg-sky-500" />
    </div>
  );
}
