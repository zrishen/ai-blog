import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Boxes, BrainCircuit, Clock, Heart, Pencil, RefreshCw, Trash2, type LucideIcon } from "lucide-react";

import { BrainManagementDialog, type BrainManagementAction } from "./BrainManagementDialog";
import { BrainGraphView } from "./BrainGraphView";
import { EntityDetailPanel } from "./EntityDetailPanel";
import { entityTypeColor, kindLabel } from "./utils/brainStyle";

import type {
  BrainEntity,
  BrainEpisode,
  BrainFact,
  BrainGraph,
  BrainGraphNode,
  BrainMemoryType,
  BrainPreference,
} from "@/api/brain";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionTitle } from "@/components/ui/section-title";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMonthDayTime } from "@/lib/datetime";
import { useAuth } from "@/stores/authStore";
import { useChat } from "@/stores/chatStore";
import { LoginDialog } from "@/features/auth";
import {
  correctBrainFact,
  deleteBrainMemory,
  getBrainGraph,
  getBrainStats,
  listBrainEntities,
  listBrainEpisodes,
  listBrainFacts,
  listBrainPreferences,
  updateBrainPreference,
} from "@/api/brain";

type BrainSection = "stats" | "graph" | "entities" | "episodes" | "preferences";

export function BrainPage() {
  const { isAuthenticated } = useAuth();
  const { state, dispatch } = useChat();
  // tab/概览统计进 chatStore，与左栏 BrainNav 兄弟共享；其余重数据本地持有
  const tab = state.brainTab;
  const stats = state.brainStats;
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [graph, setGraph] = useState<BrainGraph>({ nodes: [], edges: [] });
  const [entities, setEntities] = useState<BrainEntity[]>([]);
  const [episodes, setEpisodes] = useState<BrainEpisode[]>([]);
  const [preferences, setPreferences] = useState<BrainPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 各 section 独立结算：失败的记入此表，避免任一接口失败拖垮整页或误显示「尚未启用/还没有」
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<BrainSection, string>>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedEntity, setSelectedEntity] = useState<BrainGraphNode | null>(null);
  const [entityFacts, setEntityFacts] = useState<BrainFact[]>([]);
  const [factsLoading, setFactsLoading] = useState(false);
  const [managementAction, setManagementAction] = useState<BrainManagementAction | null>(null);
  const [mutationPending, setMutationPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    void (async () => {
      // 五个接口独立结算：成功各自 set，失败记入 sectionErrors——避免任一失败拖垮整页
      const [statsR, graphR, entsR, epsR, prefsR] = await Promise.allSettled([
        getBrainStats(),
        getBrainGraph(),
        listBrainEntities(),
        listBrainEpisodes(),
        listBrainPreferences(),
      ]);
      if (cancelled) return;
      const errs: Partial<Record<BrainSection, string>> = {};
      if (statsR.status === "fulfilled") dispatch({ type: "SET_BRAIN_STATS", payload: statsR.value });
      else errs.stats = "统计加载失败";
      if (graphR.status === "fulfilled") setGraph(graphR.value); else errs.graph = "图谱加载失败";
      if (entsR.status === "fulfilled") setEntities(entsR.value); else errs.entities = "实体加载失败";
      if (epsR.status === "fulfilled") setEpisodes(epsR.value); else errs.episodes = "记忆加载失败";
      if (prefsR.status === "fulfilled") setPreferences(prefsR.value); else errs.preferences = "偏好加载失败";
      setSectionErrors(errs);
      setError(Object.keys(errs).length ? "部分内容加载失败，已显示可用部分" : null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, dispatch, reloadKey]);

  const retry = () => {
    setSectionErrors({});
    setError(null);
    setReloadKey((k) => k + 1);
  };

  const handleSelectEntity = useCallback(async (node: BrainGraphNode | null) => {
    setSelectedEntity(node);
    if (!node) {
      setEntityFacts([]);
      return;
    }
    setFactsLoading(true);
    try {
      setEntityFacts(await listBrainFacts(node.id));
    } catch {
      setEntityFacts([]);
    } finally {
      setFactsLoading(false);
    }
  }, []);

  const handleDeleteMemory = async (memoryType: BrainMemoryType, memoryId: string) => {
    setMutationPending(true);
    setMutationError(null);
    try {
      await deleteBrainMemory(memoryType, memoryId);
      if (memoryType === "episode") {
        setEpisodes((current) => current.filter((episode) => episode.episode_id !== memoryId));
        dispatch({ type: "DECREMENT_BRAIN_STATS", payload: { field: "episodes" } });
      } else if (memoryType === "fact") {
        setEntityFacts((current) => current.filter((fact) => fact.fact_id !== memoryId));
        dispatch({ type: "DECREMENT_BRAIN_STATS", payload: { field: "facts" } });
      } else {
        setPreferences((current) => current.filter((preference) => preference.pref_id !== memoryId));
        dispatch({ type: "DECREMENT_BRAIN_STATS", payload: { field: "preferences" } });
      }
      setManagementAction(null);
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "删除记忆失败");
    } finally {
      setMutationPending(false);
    }
  };

  const handleCorrectFact = async (fact: BrainFact, objectText: string) => {
    setMutationPending(true);
    setMutationError(null);
    try {
      const corrected = await correctBrainFact(fact.fact_id, { object_text: objectText });
      setEntityFacts((current) => [...current.filter((item) => item.fact_id !== fact.fact_id), corrected]);
      setManagementAction(null);
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "纠正事实失败");
    } finally {
      setMutationPending(false);
    }
  };

  const handleUpdatePreference = async (preference: BrainPreference, value: string) => {
    setMutationPending(true);
    setMutationError(null);
    try {
      const updated = await updateBrainPreference(preference.pref_id, { value });
      setPreferences((current) => [...current.filter((item) => item.pref_id !== preference.pref_id), updated]);
      setManagementAction(null);
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "更新偏好失败");
    } finally {
      setMutationPending(false);
    }
  };

  const handleManagementDialogChange = (open: boolean) => {
    if (!open && !mutationPending) {
      setManagementAction(null);
      setMutationError(null);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="flex h-full flex-col overflow-y-auto bg-background px-8 py-6">
        <div className="mx-auto flex min-h-[60vh] w-full max-w-[760px] items-center justify-center">
          <div className="relative w-full overflow-hidden rounded-shell border border-border/70 bg-card/86 p-8 text-center shadow-xl shadow-foreground/5 backdrop-blur-xl">
            <div className="relative mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-panel bg-primary/10 text-primary ring-1 ring-primary/15">
              <BrainCircuit className="h-7 w-7" />
            </div>
            <div className="relative mb-3 text-caption font-bold uppercase tracking-[0.18em] text-primary/80">AI Brain</div>
            <SectionTitle as="h1" size="3xl" className="relative">登录后查看 AI 大脑</SectionTitle>
            <p className="relative mx-auto mt-3 max-w-md text-body leading-relaxed text-muted-foreground">
              登录后可浏览你的知识图谱、对话记忆与用户偏好，AI 会随对话不断织网。
            </p>
            <Button className="relative mt-6 rounded-full shadow-lg shadow-primary/20" onClick={() => setLoginDialogOpen(true)}>
              登录到 AI Blog
            </Button>
          </div>
        </div>
        <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
      </div>
    );
  }

  const enabled = stats?.enabled ?? false;
  const statsFailed = !!sectionErrors.stats;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background p-2">
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-shell border border-border/70 bg-card/86 shadow-xl shadow-foreground/5 backdrop-blur-xl">
        <div className="border-b border-border/70 p-3 sm:p-5">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-meta font-semibold text-primary">
            <BrainCircuit className="h-3.5 w-3.5" />
            认知记忆
          </div>
          <SectionTitle as="h1" size="2xl" className="sm:text-3xl">AI 大脑</SectionTitle>
          <p className="mt-2 max-w-2xl text-body-lg leading-relaxed text-muted-foreground">
            实体、事实、对话记忆与偏好织成一张会生长的星图——AI 越用越懂你。
          </p>
          {error && !statsFailed && (
            <Alert variant="destructive" role="alert" className="mt-4 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              <span className="flex-1">{error}</span>
              <Button size="sm" variant="ghost" onClick={retry} className="shrink-0 text-meta">
                <RefreshCw className="h-3.5 w-3.5" /> 重试
              </Button>
            </Alert>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-panel" />
              ))}
            </div>
          ) : statsFailed ? (
            <EmptyState
              icon={AlertCircle}
              title="大脑数据加载失败"
              description="未能读取大脑状态，请检查网络后重试。"
              action={
                <Button onClick={retry}>
                  <RefreshCw className="h-4 w-4" /> 重试
                </Button>
              }
              className="h-full min-h-[360px] rounded-surface"
            />
          ) : !enabled ? (
            <EmptyState
              icon={BrainCircuit}
              title="大脑尚未启用"
              description="管理员开启记忆引擎（MEMORY_ENABLED）后，这里会展示你的知识图谱、对话记忆与偏好。"
              className="h-full min-h-[360px] rounded-surface"
            />
          ) : tab === "graph" ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="h-[min(62dvh,560px)] min-h-[360px] overflow-hidden rounded-surface border border-border/70 bg-background/55 shadow-sm">
                <BrainGraphView graph={graph} onSelect={handleSelectEntity} />
              </div>
              <EntityDetailPanel
                entity={selectedEntity}
                facts={entityFacts}
                loading={factsLoading}
                onCorrectFact={(fact) => setManagementAction({ kind: "correct-fact", fact })}
                onDeleteFact={(fact) => setManagementAction({
                  kind: "delete-memory",
                  memoryType: "fact",
                  memoryId: fact.fact_id,
                  label: fact.object_text,
                })}
              />
            </div>
          ) : tab === "entities" ? (
            <EntitiesGrid entities={entities} />
          ) : tab === "episodes" ? (
            <EpisodesTimeline
              episodes={episodes}
              onDelete={(episode) => setManagementAction({
                kind: "delete-memory",
                memoryType: "episode",
                memoryId: episode.episode_id,
                label: episode.summary,
              })}
            />
          ) : (
            <PreferencesGrid
              preferences={preferences}
              onEdit={(preference) => setManagementAction({ kind: "update-preference", preference })}
              onDelete={(preference) => setManagementAction({
                kind: "delete-memory",
                memoryType: "preference",
                memoryId: preference.pref_id,
                label: preference.key,
              })}
            />
          )}
        </div>
      </section>
      <BrainManagementDialog
        action={managementAction}
        pending={mutationPending}
        error={mutationError}
        onOpenChange={handleManagementDialogChange}
        onCorrectFact={handleCorrectFact}
        onUpdatePreference={handleUpdatePreference}
        onDeleteMemory={handleDeleteMemory}
      />
    </div>
  );
}

function EmptyTabs({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  return (
    <EmptyState icon={Icon} title={title} description={desc} className="h-full min-h-[300px] rounded-surface" />
  );
}

function EntitiesGrid({ entities }: { entities: BrainEntity[] }) {
  if (entities.length === 0) {
    return <EmptyTabs icon={Boxes} title="还没有实体" desc="对话或上传文档后，AI 会抽取实体沉淀到这里。" />;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {entities.map((e) => (
        <div key={e.entity_id} className="rounded-panel border border-border/60 bg-card/60 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="mt-1 h-2 w-2 shrink-0 rounded-full"
                style={{ background: entityTypeColor(e.entity_type) }}
                aria-hidden
              />
              <div className="line-clamp-2 text-body font-black text-foreground">{e.name}</div>
            </div>
            <Badge variant="secondary" className="shrink-0 rounded-full text-caption">
              {Math.round(e.confidence * 100)}%
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {e.entity_type && <Badge variant="outline" className="rounded-full text-caption">{e.entity_type}</Badge>}
            {e.aliases.slice(0, 2).map((a) => (
              <Badge key={a} variant="outline" className="rounded-full text-caption">{a}</Badge>
            ))}
          </div>
          {e.description && (
            <p className="mt-2 line-clamp-3 text-fine leading-relaxed text-muted-foreground">{e.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function EpisodesTimeline({
  episodes,
  onDelete,
}: {
  episodes: BrainEpisode[];
  onDelete: (episode: BrainEpisode) => void;
}) {
  if (episodes.length === 0) {
    return <EmptyTabs icon={Clock} title="还没有对话记忆" desc="和 AI 聊几句，关键情节会被记成情景记忆。" />;
  }
  return (
    <div className="relative space-y-3 pl-1">
      {episodes.map((ep) => (
        <div key={ep.episode_id} className="relative pl-7">
          <span className="absolute left-0 top-3 h-3.5 w-3.5 rounded-full border-2 border-primary/40 bg-background" />
          <div className="rounded-panel border border-border/60 bg-card/60 p-4">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Badge variant="default" className="rounded-full text-caption">{kindLabel(ep.kind)}</Badge>
              {ep.occurred_at && (
                <span className="text-caption text-muted-foreground">
                  {formatMonthDayTime(ep.occurred_at)}
                </span>
              )}
            </div>
            <p className="line-clamp-4 text-fine leading-relaxed text-foreground">{ep.summary}</p>
            {ep.participants.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ep.participants.slice(0, 4).map((p) => (
                  <Badge key={p} variant="outline" className="rounded-full text-caption">{p}</Badge>
                ))}
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 rounded-control text-meta text-destructive hover:text-destructive"
              onClick={() => onDelete(ep)}
            >
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function PreferencesGrid({
  preferences,
  onEdit,
  onDelete,
}: {
  preferences: BrainPreference[];
  onEdit: (preference: BrainPreference) => void;
  onDelete: (preference: BrainPreference) => void;
}) {
  if (preferences.length === 0) {
    return <EmptyTabs icon={Heart} title="还没有记录偏好" desc="告诉 AI 你的喜好与习惯，它会沉淀成可复用的偏好。" />;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {preferences.map((p) => (
        <div key={p.pref_id} className="rounded-panel border border-border/60 bg-card/60 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="text-caption font-bold uppercase tracking-[0.1em] text-muted-foreground">{p.key}</div>
            <Badge variant="secondary" className="shrink-0 rounded-full text-caption">
              {Math.round(p.confidence * 100)}%
            </Badge>
          </div>
          <p className="mt-1.5 text-body font-semibold text-foreground">{p.value}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="rounded-control text-meta" onClick={() => onEdit(p)}>
              <Pencil className="h-3.5 w-3.5" /> 编辑
            </Button>
            <Button variant="ghost" size="sm" className="rounded-control text-meta text-destructive hover:text-destructive" onClick={() => onDelete(p)}>
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
