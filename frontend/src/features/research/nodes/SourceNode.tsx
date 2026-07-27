import { FileText } from "lucide-react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { surfaceVariants } from "@/lib/visualVariants";
import { cn } from "@/lib/utils";
import type { ResearchSource } from "@/api/client";

function trustLabel(level: string) {
  const labels: Record<string, string> = {
    high: "高可信",
    medium: "中可信",
    low: "低可信",
    unknown: "待评估",
  };
  return labels[level] ?? level;
}

export function SourceNode({ data, selected }: NodeProps) {
  const source = (data as { source: ResearchSource }).source;

  return (
    <div
      className={cn(
        surfaceVariants({ variant: selected ? "selected" : "card" }),
        "w-[240px] rounded-panel p-4 shadow-sm",
        !selected && "border-amber-500/25 bg-card/95",
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-caption font-bold uppercase tracking-[0.14em] text-muted-foreground">
        <FileText className="h-3.5 w-3.5" /> 来源
      </div>
      <div className="line-clamp-3 text-sm font-black leading-snug text-foreground">{source.title}</div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge variant="outline" className="rounded-full text-[10px]">{source.source_type}</Badge>
        <Badge variant="outline" className="rounded-full border-amber-500/25 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300">{trustLabel(source.trust_level)}</Badge>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-amber-500" />
    </div>
  );
}
