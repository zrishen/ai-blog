import { Clock } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ResearchRun } from "@/api/research";
import { formatTime } from "../utils/researchRunHelpers";
import { RunStatusBadge } from "./RunStatusBadge";

interface RunHistoryListProps {
  runs: ResearchRun[];
  selectedRunId: number | null;
  onSelect: (id: number) => void;
}

export function RunHistoryList({ runs, selectedRunId, onSelect }: RunHistoryListProps) {
  return (
    <ScrollArea className="max-h-[520px]">
      <div className="space-y-1.5 pr-2">
        <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">历史运行</div>
        {runs.map((run) => {
          const isActive = run.id === selectedRunId;
          const isRunActive = run.status === "running" || run.status === "processing";
          return (
            <button
              key={run.id}
              type="button"
              className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                isActive
                  ? "border-primary/30 bg-primary/8"
                  : "border-border/60 bg-background/55 hover:border-border hover:bg-accent/50"
              }`}
              onClick={() => onSelect(run.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">Run #{run.id}</span>
                <RunStatusBadge status={run.status} />
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{formatTime(run.started_at) ?? formatTime(run.created_at) ?? "未知时间"}</span>
              </div>
              {isRunActive && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-primary">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                  运行中...
                </div>
              )}
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
