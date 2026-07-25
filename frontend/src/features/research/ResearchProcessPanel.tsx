import {
  AlertCircle,
  Clock,
  FileSearch,
  Play,
  RefreshCw,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Surface } from "@/components/ui/surface";
import { useResearchRuns } from "./hooks/useResearchRuns";
import { RunHistoryList } from "./process/RunHistoryList";
import { RunDetail } from "./process/RunDetail";

interface ResearchProcessPanelProps {
  topicId: number;
}

export function ResearchProcessPanel({ topicId }: ResearchProcessPanelProps) {
  const {
    runs,
    selectedRun,
    selectedRunId,
    isRunning,
    loading,
    error,
    starting,
    drafting,
    setSelectedRunId,
    handleStart,
    handleRefresh,
    handleTabJump,
    handleWriteDraft,
    handleQuickDraft,
  } = useResearchRuns(topicId);

  if (loading) {
    return (
      <Surface variant="dashed" className="flex min-h-[360px] items-center justify-center rounded-surface border-primary/20 bg-primary/6 p-5 text-center text-foreground">
        <div>
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-primary/10 text-primary ring-1 ring-primary/15">
            <RefreshCw className="h-6 w-6 animate-spin" />
          </div>
          <p className="text-base font-black tracking-[-0.04em] text-foreground">加载研究过程</p>
          <p className="mt-2 max-w-[220px] text-xs leading-relaxed text-muted-foreground">正在读取研究运行记录...</p>
        </div>
      </Surface>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          className="rounded-full shadow-md shadow-primary/15"
          onClick={handleStart}
          disabled={starting}
        >
          {starting ? (
            <><RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />启动中...</>
          ) : (
            <><Play className="mr-1.5 h-3.5 w-3.5" />启动研究</>
          )}
        </Button>
        <Button size="sm" variant="outline" className="rounded-full" onClick={handleRefresh}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          刷新
        </Button>

        <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium">快捷入口：</span>
          <button className="inline-flex items-center gap-1 rounded-full px-2 py-1 transition hover:bg-primary/8 hover:text-primary" onClick={() => handleTabJump("claims")}>
            <Zap className="h-3 w-3" />事实
          </button>
          <button className="inline-flex items-center gap-1 rounded-full px-2 py-1 transition hover:bg-destructive/8 hover:text-destructive" onClick={() => handleTabJump("conflicts")}>
            <TriangleAlert className="h-3 w-3" />冲突
          </button>
          <button className="inline-flex items-center gap-1 rounded-full px-2 py-1 transition hover:bg-emerald-500/8 hover:text-emerald-700 dark:text-emerald-300" onClick={() => handleTabJump("proposals")}>
            <FileSearch className="h-3 w-3" />提案
          </button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </Alert>
      )}

      {runs.length === 0 ? (
        <Surface variant="dashed" className="flex min-h-[280px] items-center justify-center rounded-surface p-8 text-center text-foreground">
          <div>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
              <Clock className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-black tracking-[-0.03em] text-foreground">暂无研究运行记录</h2>
            <p className="mt-2 text-sm text-muted-foreground">点击上方「启动研究」按钮开始新一轮研究。</p>
          </div>
        </Surface>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <RunHistoryList
            runs={runs}
            selectedRunId={selectedRunId}
            onSelect={setSelectedRunId}
          />

          {!selectedRun ? (
            <Surface variant="dashed" className="flex min-h-[200px] items-center justify-center rounded-panel text-sm">
              选择左侧运行记录查看详情
            </Surface>
          ) : (
            <RunDetail
              run={selectedRun}
              isRunning={isRunning}
              drafting={drafting}
              onWriteDraft={handleWriteDraft}
              onQuickDraft={handleQuickDraft}
            />
          )}
        </div>
      )}
    </div>
  );
}
