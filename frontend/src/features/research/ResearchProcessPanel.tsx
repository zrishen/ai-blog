import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Brain,
  ChevronDown,
  CheckCircle2,
  Clock,
  FileEdit,
  FileSearch,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import {
  attachResearchTopicToPost,
  createBlogPost,
  draftResearch,
  getResearchTopic,
  listResearchRuns,
  runResearchTopic,
} from "../../api/client";
import type { ResearchRun } from "../../api/client";
import { useChat } from "../../stores/chatStore";

const STAGE_KEYS = [
  "search_sources",
  "fetch_pages",
  "extract_claims",
  "detect_conflicts",
  "await_review",
] as const;

type StageKey = (typeof STAGE_KEYS)[number];

const STAGE_LABELS: Record<StageKey, string> = {
  search_sources: "搜索来源",
  fetch_pages: "抓取页面",
  extract_claims: "提取事实",
  detect_conflicts: "检测冲突",
  await_review: "等待审核",
};

const STAGE_ICONS: Record<StageKey, typeof Search> = {
  search_sources: Search,
  fetch_pages: FileSearch,
  extract_claims: Zap,
  detect_conflicts: AlertCircle,
  await_review: ShieldCheck,
};

function formatTime(dateStr?: string | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return d.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusBadge(status: string) {
  if (status === "completed" || status === "done") return <Badge className="rounded-full bg-emerald-600 text-white">已完成</Badge>;
  if (status === "running" || status === "processing") return <Badge className="rounded-full bg-primary text-primary-foreground">运行中</Badge>;
  if (status === "failed" || status === "error") return <Badge variant="outline" className="rounded-full border-destructive/25 bg-destructive/10 text-destructive">失败</Badge>;
  if (status === "pending" || status === "queued") return <Badge variant="outline" className="rounded-full">排队中</Badge>;
  return <Badge variant="outline" className="rounded-full">{status}</Badge>;
}

function getStageProgress(progress: Record<string, unknown>): Array<{ key: StageKey; label: string; done: boolean; current: boolean }> {
  let foundCurrent = false;
  const activeKey = STAGE_KEYS.find((key) => {
    const val = progress[key];
    return val === "running" || val === "processing" || val === "started";
  });

  return STAGE_KEYS.map((key) => {
    const val = progress[key];
    const done = val === true || val === "done" || val === "completed";
    const current = !done && (activeKey ? key === activeKey : !foundCurrent);
    if (current) foundCurrent = true;
    return { key, label: STAGE_LABELS[key], done, current };
  });
}

// ---- Operation log types (aligned with backend progress_json) ----

interface OperationLog {
  ts: string;
  type: "tool" | "thinking";
  tool?: string;
  action: string;
  detail: string;
  status: "ok" | "error" | "info";
}

function getStageLogs(progress: Record<string, unknown>, stageKey: StageKey): OperationLog[] {
  const raw = progress[`${stageKey}_log`];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is OperationLog => (
      typeof item === "object" && item !== null &&
      typeof item.ts === "string" && typeof item.action === "string"
    ))
    .slice(-50);
}

const LOG_STATUS_ICON: Record<OperationLog["status"], typeof CheckCircle2> = {
  ok: CheckCircle2,
  error: XCircle,
  info: Search,
};

interface StageProgressItem {
  key: StageKey;
  label: string;
  done: boolean;
  current: boolean;
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
              ? "border-emerald-500/15 bg-emerald-500/5"
              : "border-border/60 bg-background/40"
        }`}
      >
        <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
          stage.done
            ? "bg-emerald-500/10 text-emerald-600"
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
        <span className={`text-[13px] font-medium ${
          stage.done ? "text-emerald-700 dark:text-emerald-300" : stage.current ? "text-primary" : "text-muted-foreground"
        }`}>
          {stage.label}
        </span>
        {isRunningStage && (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-medium text-primary">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            执行中
          </span>
        )}
        {stage.done && (
          <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-emerald-500" />
        )}
      </div>

      {(hasLogs || isRunningStage) && (
        <Collapsible defaultOpen={defaultOpen} className="ml-10 mt-1">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/50 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground">
              <ChevronDown className="h-3 w-3 transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
              <span>操作日志</span>
              <span className="text-primary">({logs.length})</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1.5 space-y-1.5 rounded-lg border border-border/40 bg-muted/25 p-2.5">
            {!hasLogs && isRunningStage && (
              <div className="flex items-center gap-2 py-3 text-[11px] text-muted-foreground/60">
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
                    className={`flex items-start gap-1.5 text-[11px] text-muted-foreground ${isError ? "rounded-md bg-destructive/5 pl-2 border-l-2 border-destructive/30" : ""}`}
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

interface ResearchProcessPanelProps {
  topicId: number;
}

export function ResearchProcessPanel({ topicId }: ResearchProcessPanelProps) {
  const navigate = useNavigate();
  const { dispatch, state } = useChat();
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const selectedRunIdRef = useRef<number | null>(null);

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;
  const isRunning = selectedRun?.status === "running" || selectedRun?.status === "processing";

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  const loadRuns = useCallback(async (selectLatest = false) => {
    try {
      const data = await listResearchRuns(topicId);
      if (!mountedRef.current) return;
      setRuns(data);
      if (data.length > 0 && (selectLatest || !selectedRunIdRef.current)) {
        setSelectedRunId(data[0].id);
      }
      setError(null);
    } catch {
      if (!mountedRef.current) return;
      setError("加载研究运行记录失败");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [topicId]);

  useEffect(() => {
    mountedRef.current = true;
    queueMicrotask(() => {
      if (mountedRef.current) void loadRuns();
    });
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadRuns]);

  // Auto-poll when selected run is active
  useEffect(() => {
    if (!isRunning) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(() => {
      loadRuns();
    }, 4000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [isRunning, loadRuns]);

  const handleStart = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      await runResearchTopic(topicId, `process-${topicId}-${Date.now()}`);
      // Refresh topic detail so other tabs see updated data
      try {
        const detail = await getResearchTopic(topicId);
        dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
      } catch {
        // 主题详情刷新是启动研究后的最佳努力同步。
      }
      await loadRuns(true);
    } catch {
      setError("启动研究任务失败，请稍后重试");
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  }, [topicId, loadRuns, dispatch]);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    loadRuns();
  }, [loadRuns]);

  const handleTabJump = useCallback((tab: string) => {
    navigate(`/research/${topicId}?tab=${tab}`, { replace: true });
  }, [navigate, topicId]);

  const topicTitle = state.researchCurrentTopic?.title;

  // Generate draft via backend draft-preview API and create blog post
  const handleWriteDraft = useCallback(async () => {
    setDrafting(true);
    setError(null);
    try {
      const preview = await draftResearch(topicId);
      const post = await createBlogPost({
        title: preview.title || `${topicTitle ?? "研究"} - 博客草稿`,
        content: preview.content,
        status: "draft",
      });
      await attachResearchTopicToPost(post.id, topicId);
      navigate(`/blog/edit/${post.id}`, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`生成草稿失败：${msg}`);
    } finally {
      if (mountedRef.current) setDrafting(false);
    }
  }, [topicId, topicTitle, navigate]);

  // Quick-create a blank blog post linked to this research topic
  const handleQuickDraft = useCallback(async () => {
    setDrafting(true);
    setError(null);
    try {
      const post = await createBlogPost({
        title: `${topicTitle ?? "研究"} - 博客草稿`,
        content: "",
        status: "draft",
      });
      await attachResearchTopicToPost(post.id, topicId);
      navigate(`/blog/edit/${post.id}`, { replace: true });
    } catch {
      setError("创建草稿失败，请稍后重试");
    } finally {
      if (mountedRef.current) setDrafting(false);
    }
  }, [topicId, topicTitle, navigate]);

  // ---- Render ----

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-[1.6rem] border border-dashed border-primary/20 bg-primary/6 p-5 text-center">
        <div>
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-primary/10 text-primary ring-1 ring-primary/15">
            <RefreshCw className="h-6 w-6 animate-spin" />
          </div>
          <p className="text-base font-black tracking-[-0.04em] text-foreground">加载研究过程</p>
          <p className="mt-2 max-w-[220px] text-xs leading-relaxed text-muted-foreground">正在读取研究运行记录...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
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
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          刷新
        </Button>

        {/* Quick nav to other tabs */}
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
        <div className="flex items-center gap-2 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Empty state */}
      {runs.length === 0 ? (
        <div className="flex min-h-[280px] items-center justify-center rounded-[1.6rem] border border-dashed border-border/80 bg-background/45 p-8 text-center">
          <div>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
              <Clock className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-black tracking-[-0.03em] text-foreground">暂无研究运行记录</h2>
            <p className="mt-2 text-sm text-muted-foreground">点击上方「启动研究」按钮开始新一轮研究。</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          {/* Run history sidebar */}
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
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground">Run #{run.id}</span>
                      {statusBadge(run.status)}
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

          {/* Selected run detail */}
          <div className="min-w-0 space-y-4">
            {!selectedRun ? (
              <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/45 text-sm text-muted-foreground">
                选择左侧运行记录查看详情
              </div>
            ) : (
              <>
                {/* Run header */}
                <div className="rounded-[1.6rem] border border-border/70 bg-background/55 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-black text-foreground">Run #{selectedRun.id}</h2>
                        {statusBadge(selectedRun.status)}
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                        <span>开始：{formatTime(selectedRun.started_at) ?? "-"}</span>
                        <span>结束：{formatTime(selectedRun.finished_at) ?? (isRunning ? "进行中..." : "-")}</span>
                      </div>
                    </div>
                    {isRunning && (
                      <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                        研究任务执行中
                      </div>
                    )}
                  </div>

                  {selectedRun.error_message && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
                      <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      <span>{selectedRun.error_message}</span>
                    </div>
                  )}
                </div>

                {/* Stage timeline */}
                <div className="rounded-[1.6rem] border border-border/70 bg-background/55 p-5">
                  <div className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">阶段进度</div>
                  <div className="space-y-2">
                    {getStageProgress(selectedRun.progress ?? {}).map((stage) => (
                      <StageRow
                        key={stage.key}
                        stage={stage}
                        logs={getStageLogs(selectedRun.progress ?? {}, stage.key)}
                        isRunningStage={stage.current && isRunning}
                      />
                    ))}
                  </div>
                </div>

                {/* Draft entry — show when run is completed */}
                {(() => {
                  const isCompleted = selectedRun.status === "completed" || selectedRun.status === "done";
                  if (!isCompleted) return null;
                  return (
                    <div className="rounded-[1.6rem] border border-emerald-500/20 bg-emerald-500/5 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                              <FileEdit className="h-4 w-4" />
                            </div>
                            <h3 className="text-sm font-black text-foreground">研究已完成，开始写作</h3>
                          </div>
                          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                            研究运行已结束。你可以让 AI 基于已确认事实生成草稿，或先创建空白草稿手动编辑。
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2.5">
                        <Button
                          size="sm"
                          className="rounded-full shadow-md shadow-primary/15"
                          onClick={handleWriteDraft}
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
                          onClick={handleQuickDraft}
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
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
