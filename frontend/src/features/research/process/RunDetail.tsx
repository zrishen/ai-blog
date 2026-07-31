import { useEffect, useRef } from "react";
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  FileEdit,
  RefreshCw,
  Search,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ResearchRun } from "@/api/research";
import {
  formatTime,
  getStageLogs,
  getStageProgress,
  LOG_STATUS_ICON,
  STAGE_ICONS,
  type OperationLog,
  type StageProgressItem,
} from "../utils/researchRunHelpers";
import { RunStatusBadge } from "./RunStatusBadge";

interface RunDetailProps {
  run: ResearchRun;
  isRunning: boolean;
  drafting: boolean;
  onWriteDraft: () => void;
  onQuickDraft: () => void;
}

export function RunDetail({ run, isRunning, drafting, onWriteDraft, onQuickDraft }: RunDetailProps) {
  const progress = run.progress ?? {};
  const stages = getStageProgress(progress);
  const isCompleted = run.status === "completed" || run.status === "done";

  return (
    <div className="min-w-0 space-y-4">
      <div className="rounded-surface border border-border/70 bg-background/55 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-reading font-black text-foreground">Run #{run.id}</h2>
              <RunStatusBadge status={run.status} />
            </div>
            <div className="mt-2 grid gap-1 text-fine text-muted-foreground sm:grid-cols-2">
              <span>开始：{formatTime(run.started_at) ?? "-"}</span>
              <span>结束：{formatTime(run.finished_at) ?? (isRunning ? "进行中..." : "-")}</span>
            </div>
          </div>
          {isRunning && (
            <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-fine font-medium text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              研究任务执行中
            </div>
          )}
        </div>

        {run.error_message && (
          <Alert variant="destructive" className="mt-3 flex items-start gap-2 py-2.5 text-fine">
            <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>{run.error_message}</span>
          </Alert>
        )}
      </div>

      <div className="rounded-surface border border-border/70 bg-background/55 p-5">
        <div className="mb-3 text-fine font-bold uppercase tracking-[0.14em] text-muted-foreground">阶段进度</div>
        <div className="space-y-2">
          {stages.map((stage) => (
            <StageRow
              key={stage.key}
              stage={stage}
              logs={getStageLogs(progress, stage.key)}
              isRunningStage={stage.current && isRunning}
            />
          ))}
        </div>
      </div>

      {isCompleted && (
        <div className="rounded-surface border border-success/20 bg-success/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10 text-success">
                  <FileEdit className="h-4 w-4" />
                </div>
                <h3 className="text-body font-black text-foreground">研究已完成，开始写作</h3>
              </div>
              <p className="mt-1.5 text-fine leading-relaxed text-muted-foreground">
                研究运行已结束。你可以让 AI 基于已确认事实生成草稿，或先创建空白草稿手动编辑。
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Button
              size="sm"
              className="rounded-full shadow-md shadow-primary/15"
              onClick={onWriteDraft}
              disabled={drafting}
            >
              {drafting ? (
                <><RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />生成中...</>
              ) : (
                <><Zap className="mr-1.5 h-3.5 w-3.5" />AI 生成草稿</>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={onQuickDraft}
              disabled={drafting}
            >
              {drafting ? (
                <><RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />创建中...</>
              ) : (
                <><FileEdit className="mr-1.5 h-3.5 w-3.5" />创建空白草稿</>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface StageRowProps {
  stage: StageProgressItem;
  logs: OperationLog[];
  isRunningStage: boolean;
}

function StageRow({ stage, logs, isRunningStage }: StageRowProps) {
  const logContainerRef = useRef<HTMLDivElement>(null);
  const Icon = STAGE_ICONS[stage.key];
  const hasLogs = logs.length > 0;
  const defaultOpen = isRunningStage || hasLogs;

  useEffect(() => {
    if (hasLogs && logContainerRef.current) {
      logContainerRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [logs.length, hasLogs]);

  return (
    <div>
      <div
        className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition ${
          stage.current
            ? "border-primary/30 bg-primary/8"
            : stage.done
              ? "border-success/15 bg-success/5"
              : "border-border/60 bg-background/40"
        }`}
      >
        <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
          stage.done
            ? "bg-success/10 text-success"
            : stage.current
              ? "bg-primary/10 text-primary ring-1 ring-primary/20"
              : "bg-muted text-muted-foreground"
        }`}>
          {stage.done ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <Icon className="h-3.5 w-3.5" />
          )}
        </div>
        <span className={`text-meta font-medium ${
          stage.done ? "text-success" : stage.current ? "text-primary" : "text-muted-foreground"
        }`}>
          {stage.label}
        </span>
        {isRunningStage && (
          <span className="ml-auto flex items-center gap-1 text-caption font-medium text-primary">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            执行中
          </span>
        )}
        {stage.done && (
          <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-success" />
        )}
      </div>

      {(hasLogs || isRunningStage) && (
        <Collapsible defaultOpen={defaultOpen} className="ml-10 mt-1">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/50 px-2.5 py-1.5 text-caption font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground">
              <ChevronDown className="h-3 w-3 transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
              <span>操作日志</span>
              <span className="text-primary">({logs.length})</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1.5 space-y-1.5 rounded-lg border border-border/40 bg-muted/25 p-2.5">
            {!hasLogs && isRunningStage && (
              <div className="flex items-center gap-2 py-3 text-caption text-muted-foreground/60">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/50" />
                等待操作日志...
              </div>
            )}
            <div ref={logContainerRef}>
              {logs.map((log, li) => {
                const StatusIcon = LOG_STATUS_ICON[log.status] ?? Search;
                const isError = log.status === "error";
                const timeStr = new Date(log.ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                return (
                  <div
                    key={li}
                    className={`flex items-start gap-1.5 text-caption text-muted-foreground ${isError ? "rounded-control bg-destructive/5 pl-2 border-l-2 border-destructive/30" : ""}`}
                  >
                    {log.type === "thinking" ? (
                      <Brain className="mt-0.5 h-3 w-3 flex-shrink-0 text-primary/60" />
                    ) : (
                      <StatusIcon className={`mt-0.5 h-3 w-3 flex-shrink-0 ${isError ? "text-destructive" : log.status === "ok" ? "text-primary/70" : "text-muted-foreground/70"}`} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        {log.action}
                        {log.tool && <span className="font-normal text-muted-foreground">· {log.tool}</span>}
                        <span className="ml-auto flex-shrink-0 text-[10px] font-normal text-muted-foreground/50">{timeStr}</span>
                      </div>
                      {log.detail && (
                        <div className="mt-0.5 truncate pl-2 text-[10px] text-muted-foreground/80">{log.detail}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
