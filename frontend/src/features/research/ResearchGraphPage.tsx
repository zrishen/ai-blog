import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertCircle, BrainCircuit, CheckCircle2, ExternalLink, FileSearch, GitBranch, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "../../stores/authStore";
import { useChat } from "../../stores/chatStore";
import { getResearchTopic, resolveResearchConflict, updateResearchClaim, updateResearchProposal } from "../../api/client";
import type { ResearchTopicDetail } from "../../api/client";
import { LoginDialog } from "../auth/LoginDialog";
import { ResearchGraphView } from "./ResearchGraphView";

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "未检查";
  return new Date(dateStr).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    researching: "研究中",
    reviewing: "待审核",
    ready: "已确认",
    stale: "可能过期",
    archived: "已归档",
    pending: "待审核",
    supported: "已支持",
    conflicting: "有冲突",
    rejected: "已拒绝",
  };
  return labels[status] ?? status;
}

function sourceTypeLabel(type: string) {
  const labels: Record<string, string> = {
    official: "官方",
    media: "媒体",
    paper: "论文",
    blog: "博客",
    forum: "论坛",
    social: "社交",
    knowledge_base: "知识库",
    mcp_result: "MCP",
    manual: "手动",
  };
  return labels[type] ?? type;
}

function trustLabel(level: string) {
  const labels: Record<string, string> = {
    high: "高可信",
    medium: "中可信",
    low: "低可信",
    unknown: "待评估",
  };
  return labels[level] ?? level;
}

function statusTone(status: string) {
  if (["supported", "ready", "approved", "applied"].includes(status)) return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (["conflicting", "stale", "rejected", "failed"].includes(status)) return "border-destructive/25 bg-destructive/10 text-destructive";
  return "border-primary/20 bg-primary/10 text-primary";
}

type ProposalConflictSummary = {
  between: string;
  reason: string;
};

function numberArrayField(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
}

function numberField(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "number" ? value : null;
}

function stringField(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function conflictField(payload: Record<string, unknown>) {
  const value = payload.conflicts;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ProposalConflictSummary[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const between = stringField(record, "between");
    const reason = stringField(record, "reason");
    return between || reason ? [{ between, reason }] : [];
  });
}

function proposalOneLineSummary(payload?: Record<string, unknown> | null) {
  if (!payload) return "暂无结构化摘要";
  const parts = [
    numberArrayField(payload, "new_sources").length ? `新增来源 ${numberArrayField(payload, "new_sources").length} 个` : null,
    numberArrayField(payload, "new_claims").length ? `新增事实 ${numberArrayField(payload, "new_claims").length} 条` : null,
    numberField(payload, "new_relations") !== null ? `新增关系 ${numberField(payload, "new_relations")} 条` : null,
    conflictField(payload).length ? `冲突 ${conflictField(payload).length} 个` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "包含系统更新明细";
}

function ProposalPayloadSummary({ payload, topic }: { payload: Record<string, unknown>; topic: ResearchTopicDetail }) {
  const sourceIds = numberArrayField(payload, "new_sources");
  const claimIds = numberArrayField(payload, "new_claims");
  const relationCount = numberField(payload, "new_relations");
  const totalSources = numberField(payload, "total_sources");
  const totalClaims = numberField(payload, "total_claims");
  const conflicts = conflictField(payload);
  const hasSummary = sourceIds.length || claimIds.length || relationCount !== null || conflicts.length || totalSources !== null || totalClaims !== null;

  if (!hasSummary) {
    return (
      <div className="mt-3 rounded-2xl border border-border/70 bg-card/70 p-3 text-xs leading-relaxed text-muted-foreground">
        这条提案包含系统更新明细，但当前没有可展示的摘要字段；请结合标题和说明决定是否审核。
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-border/70 bg-card/70 p-4">
      <div className="flex flex-wrap gap-2">
        {sourceIds.length > 0 && <Badge variant="outline" className="rounded-full">新增来源 {sourceIds.length} 个</Badge>}
        {claimIds.length > 0 && <Badge variant="outline" className="rounded-full">新增事实 {claimIds.length} 条</Badge>}
        {relationCount !== null && <Badge variant="outline" className="rounded-full">新增关系 {relationCount} 条</Badge>}
        {conflicts.length > 0 && <Badge variant="outline" className="rounded-full border-destructive/25 bg-destructive/10 text-destructive">发现冲突 {conflicts.length} 个</Badge>}
        {(totalSources !== null || totalClaims !== null) && (
          <Badge variant="outline" className="rounded-full">
            当前总量：{totalSources ?? topic.source_count} 个来源 / {totalClaims ?? topic.claim_count} 条事实
          </Badge>
        )}
      </div>

      {sourceIds.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-bold text-foreground">新增来源</div>
          <div className="space-y-1.5">
            {sourceIds.map((id) => {
              const source = topic.sources.find((item) => item.id === id);
              return (
                <div key={id} className="rounded-xl bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{source?.title ?? `来源 #${id}`}</span>
                  {source && <span> · {sourceTypeLabel(source.source_type)} · {trustLabel(source.trust_level)}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {claimIds.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-bold text-foreground">新增事实</div>
          <div className="space-y-1.5">
            {claimIds.map((id) => {
              const claim = topic.claims.find((item) => item.id === id);
              return (
                <div key={id} className="rounded-xl bg-background/70 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">{claim?.claim_text ?? `事实 #${id}`}</span>
                  {claim && <span> · {statusLabel(claim.status)} · 置信度 {claim.confidence}%</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {conflicts.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-bold text-destructive">发现冲突</div>
          <div className="space-y-1.5">
            {conflicts.map((conflict, index) => (
              <div key={`${conflict.between}-${index}`} className="rounded-xl border border-destructive/15 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                <div className="font-semibold text-foreground">{conflict.between || `冲突 ${index + 1}`}</div>
                {conflict.reason && <div className="mt-1">{conflict.reason}</div>}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">建议先处理冲突，再把相关事实写成确定结论。</p>
        </div>
      )}
    </div>
  );
}

export function ResearchGraphPage() {
  const { topicId } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { state, dispatch } = useChat();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [error, setError] = useState<string | null>(null);
  const [runNote, setRunNote] = useState<string | null>(null);
  const [proposalNote, setProposalNote] = useState<string | null>(null);
  const [conflictNote, setConflictNote] = useState<string | null>(null);
  const [resolvingConflictId, setResolvingConflictId] = useState<number | null>(null);

  const selectedTopic = state.researchCurrentTopic;

  // Sync URL topicId to state and load detail
  useEffect(() => {
    const routeTopicId = topicId ? Number(topicId) : null;
    if (routeTopicId && routeTopicId !== state.researchCurrentTopicId) {
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC_ID", payload: routeTopicId });
      dispatch({ type: "SET_RESEARCH_SELECTED_CLAIM_ID", payload: null });
      dispatch({ type: "SET_RESEARCH_SELECTED_CONFLICT_ID", payload: null });
      dispatch({ type: "SET_RESEARCH_SELECTED_PROPOSAL_ID", payload: null });
      getResearchTopic(routeTopicId)
        .then((detail) => dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail }))
        .catch((err) => setError(err instanceof Error ? err.message : "研究主题加载失败"));
    } else if (!routeTopicId && state.researchTopics.length > 0 && !state.researchCurrentTopicId) {
      const first = state.researchTopics[0];
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC_ID", payload: first.id });
      navigate(`/research/${first.id}`, { replace: true });
      getResearchTopic(first.id)
        .then((detail) => dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail }))
        .catch((err) => setError(err instanceof Error ? err.message : "研究主题加载失败"));
    } else if (!routeTopicId && state.researchTopics.length === 0) {
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: null });
    }
  }, [topicId, state.researchTopics]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunTopic = useCallback(async () => {
    if (!state.researchCurrentTopicId) return;
    setError(null);
    setRunNote(null);
    setProposalNote(null);
    setConflictNote(null);
    try {
      const detail = await getResearchTopic(state.researchCurrentTopicId);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
    } catch {}
    dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: true });
    dispatch({ type: "SET_TRUST_WRITING_ENABLED", payload: true });
    dispatch({ type: "SET_PENDING_RESEARCH_PROMPT", payload: "open_research_choices" });
    setRunNote("已在右侧 AI 侧边栏显示研究写作选择，请选择继续研究、去图谱审核或不选择。");
  }, [dispatch, state.researchCurrentTopicId]);

  const handleUpdateClaim = useCallback(async (claimId: number, data: { status?: string; adopted?: boolean }) => {
    if (!state.researchCurrentTopicId) return;
    setError(null);
    setProposalNote(null);
    setConflictNote(null);
    try {
      await updateResearchClaim(claimId, data);
      const detail = await getResearchTopic(state.researchCurrentTopicId);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
    } catch (err) {
      setError(err instanceof Error ? err.message : "事实审核失败");
    }
  }, [dispatch, state.researchCurrentTopicId]);

  const handleResolveConflict = useCallback(async (relationId: number, acceptedClaimId: number, rejectedClaimId: number) => {
    if (!state.researchCurrentTopicId) return;
    setError(null);
    setProposalNote(null);
    setConflictNote(null);
    setResolvingConflictId(relationId);
    dispatch({ type: "SET_RESEARCH_SELECTED_CONFLICT_ID", payload: relationId });
    try {
      await resolveResearchConflict(relationId, {
        accepted_claim_id: acceptedClaimId,
        rejected_claim_id: rejectedClaimId,
      });
      const detail = await getResearchTopic(state.researchCurrentTopicId);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
      setConflictNote("冲突已解决，已采用的事实会进入可信写作上下文。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "冲突解决失败");
    } finally {
      setResolvingConflictId(null);
    }
  }, [dispatch, state.researchCurrentTopicId]);

  const handleUpdateProposal = useCallback(async (proposalId: number, status: string) => {
    if (!state.researchCurrentTopicId) return;
    const proposal = selectedTopic?.proposals.find((item) => item.id === proposalId);
    const batchClaimCount = proposal?.payload_json ? numberArrayField(proposal.payload_json, "new_claims").length : 0;
    const adoptedBefore = new Set((selectedTopic?.claims ?? []).filter((claim) => claim.adopted).map((claim) => claim.id));
    setError(null);
    setProposalNote(null);
    setConflictNote(null);
    try {
      await updateResearchProposal(proposalId, { status });
      const detail = await getResearchTopic(state.researchCurrentTopicId);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
      if (status === "applied") {
        if (batchClaimCount > 0) {
          setProposalNote(`已应用提案；本次包含 ${batchClaimCount} 条事实，请在提案详情中采用，或使用一键采用安全事实。`);
          return;
        }
        const autoAdoptedCount = detail.claims.filter((claim) => claim.adopted && !adoptedBefore.has(claim.id)).length;
        setProposalNote(autoAdoptedCount > 0
          ? `已应用提案，并自动采用 ${autoAdoptedCount} 条安全事实。`
          : "已应用提案。"
        );
      } else if (status === "rejected") {
        setProposalNote("已拒绝提案。");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "提案审核失败");
    }
  }, [dispatch, selectedTopic?.claims, selectedTopic?.proposals, state.researchCurrentTopicId]);

  const evidenceForClaim = useCallback((claimId: number) => {
    if (!selectedTopic) return [];
    const evidenceIds = selectedTopic.relations
      .filter((relation) => relation.from_type === "evidence" && relation.to_type === "claim" && relation.to_id === claimId && relation.relation_type === "supports")
      .map((relation) => relation.from_id);
    return selectedTopic.evidence.filter((item) => evidenceIds.includes(item.id));
  }, [selectedTopic]);

  const sourceForEvidence = useCallback((sourceId?: number | null) => {
    if (!selectedTopic || !sourceId) return null;
    return selectedTopic.sources.find((source) => source.id === sourceId) ?? null;
  }, [selectedTopic]);

  const conflictPairs = selectedTopic?.relations
    .filter((relation) => relation.from_type === "claim" && relation.to_type === "claim" && relation.relation_type === "conflicts_with")
    .map((relation) => ({
      relation,
      fromClaim: selectedTopic.claims.find((claim) => claim.id === relation.from_id),
      toClaim: selectedTopic.claims.find((claim) => claim.id === relation.to_id),
      resolved: Boolean(relation.metadata_json?.resolved_at),
      acceptedClaimId: typeof relation.metadata_json?.accepted_claim_id === "number" ? relation.metadata_json.accepted_claim_id : null,
      rejectedClaimId: typeof relation.metadata_json?.rejected_claim_id === "number" ? relation.metadata_json.rejected_claim_id : null,
    })) ?? [];

  const selectedProposal = selectedTopic?.proposals.find((proposal) => proposal.id === state.researchSelectedProposalId) ?? null;

  const claimHasConflict = useCallback((claimId: number) => {
    return conflictPairs.some(({ relation }) => relation.from_id === claimId || relation.to_id === claimId);
  }, [conflictPairs]);

  const claimsForProposal = useCallback((proposal: ResearchTopicDetail["proposals"][number]) => {
    if (!selectedTopic || !proposal.payload_json) return [];
    const claimIds = numberArrayField(proposal.payload_json, "new_claims");
    return claimIds.flatMap((id) => {
      const claim = selectedTopic.claims.find((item) => item.id === id);
      return claim ? [claim] : [];
    });
  }, [selectedTopic]);

  const sourcesForProposal = useCallback((proposal: ResearchTopicDetail["proposals"][number]) => {
    if (!selectedTopic || !proposal.payload_json) return [];
    const sourceIds = numberArrayField(proposal.payload_json, "new_sources");
    return sourceIds.flatMap((id) => {
      const source = selectedTopic.sources.find((item) => item.id === id);
      return source ? [source] : [];
    });
  }, [selectedTopic]);

  const isClaimSafeForOneClickAdopt = useCallback((claim: ResearchTopicDetail["claims"][number]) => {
    if (claim.adopted) return false;
    if (["rejected", "stale", "conflicted", "conflicting"].includes(claim.status)) return false;
    if (claim.confidence < 70) return false;
    if (claimHasConflict(claim.id)) return false;
    return evidenceForClaim(claim.id).length > 0;
  }, [claimHasConflict, evidenceForClaim]);

  const handleAdoptProposalClaim = useCallback(async (claimId: number) => {
    if (!state.researchCurrentTopicId) return;
    setError(null);
    setProposalNote(null);
    setConflictNote(null);
    try {
      await updateResearchClaim(claimId, { status: "supported", adopted: true });
      const detail = await getResearchTopic(state.researchCurrentTopicId);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
      setProposalNote("已采用此事实。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "事实采用失败");
    }
  }, [dispatch, state.researchCurrentTopicId]);

  const handleAdoptSafeProposalClaims = useCallback(async (proposal: ResearchTopicDetail["proposals"][number]) => {
    if (!state.researchCurrentTopicId) return;
    const proposalClaims = claimsForProposal(proposal);
    const safeClaims = proposalClaims.filter(isClaimSafeForOneClickAdopt);
    const safeClaimIds = new Set(safeClaims.map((claim) => claim.id));
    const manualCount = proposalClaims.filter((claim) => !claim.adopted && !safeClaimIds.has(claim.id)).length;
    setError(null);
    setProposalNote(null);
    setConflictNote(null);
    if (safeClaims.length === 0) {
      setProposalNote(manualCount > 0 ? `没有可一键采用的安全事实；${manualCount} 条事实仍需人工确认。` : "提案中的事实已采用或无需一键采用。");
      return;
    }
    try {
      for (const claim of safeClaims) {
        await updateResearchClaim(claim.id, { status: "supported", adopted: true });
      }
      await updateResearchProposal(proposal.id, { status: "applied" });
      const detail = await getResearchTopic(state.researchCurrentTopicId);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
      setProposalNote(`已采用 ${safeClaims.length} 条安全事实；${manualCount} 条事实仍需人工确认。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "一键采用失败");
    }
  }, [claimsForProposal, dispatch, isClaimSafeForOneClickAdopt, state.researchCurrentTopicId]);

  if (!isAuthenticated) {
    return (
      <div className="flex h-full flex-col overflow-y-auto bg-background px-8 py-6">
        <div className="mx-auto flex min-h-[60vh] w-full max-w-[760px] items-center justify-center">
          <div className="relative w-full overflow-hidden rounded-[2rem] border border-border/70 bg-card/86 p-8 text-center shadow-xl shadow-foreground/5 backdrop-blur-xl">
            <div className="relative mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-primary/10 text-primary ring-1 ring-primary/15">
              <GitBranch className="h-7 w-7" />
            </div>
            <div className="relative mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-primary/80">Research Graph</div>
            <h1 className="relative text-3xl font-black tracking-[-0.04em] text-foreground">登录后查看研究图谱</h1>
            <p className="relative mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              登录后可创建研究主题、审核事实依据，并把可信事实关联到博客写作流程。
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

  const tabs = [
    ["overview", "概览"],
    ["claims", "事实"],
    ["sources", "来源"],
    ["conflicts", "冲突"],
    ["graph", "图谱"],
    ["proposals", "提案"],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-background p-2">
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[1.8rem] border border-border/70 bg-card/86 shadow-xl shadow-foreground/5 backdrop-blur-xl">
        <div className="border-b border-border/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <BrainCircuit className="h-3.5 w-3.5" />
                事实审核台
              </div>
              <h1 className="text-3xl font-black tracking-[-0.04em] text-foreground">{selectedTopic?.title ?? "研究图谱"}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {selectedTopic?.description || "围绕主题整理来源、证据、事实、冲突和 Agent 更新提案。"}
              </p>
            </div>
            <Button className="rounded-full shadow-lg shadow-primary/20" onClick={handleRunTopic} disabled={!state.researchCurrentTopicId}>
              <FileSearch className="h-3.5 w-3.5" />
              更新图谱
            </Button>
          </div>

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {proposalNote && (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              {proposalNote}
            </div>
          )}

          {conflictNote && (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              {conflictNote}
            </div>
          )}

          {runNote && (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">
              <FileSearch className="h-4 w-4" />
              {runNote}
            </div>
          )}
        </div>

        <div className="flex gap-1 border-b border-border/70 px-4 py-2">
          {tabs.map(([key, label]) => (
            <Button
              key={key}
              variant={activeTab === key ? "default" : "ghost"}
              size="sm"
              className="rounded-full"
              onClick={() => setActiveTab(key)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!selectedTopic ? (
            <div className="flex h-full min-h-[360px] items-center justify-center rounded-[1.6rem] border border-dashed border-border/80 bg-background/45 p-8 text-center">
              <div>
                <GitBranch className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                <h2 className="text-xl font-black tracking-[-0.03em] text-foreground">暂无可审核主题</h2>
                <p className="mt-2 text-sm text-muted-foreground">创建主题后，这里会展示来源、事实、冲突和提案。</p>
              </div>
            </div>
          ) : activeTab === "overview" ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-3xl border border-border/70 bg-background/55 p-5">
                  <div className="text-sm text-muted-foreground">来源数量</div>
                  <div className="mt-2 text-3xl font-black text-foreground">{selectedTopic.source_count}</div>
                </div>
                <div className="rounded-3xl border border-border/70 bg-background/55 p-5">
                  <div className="text-sm text-muted-foreground">事实数量</div>
                  <div className="mt-2 text-3xl font-black text-foreground">{selectedTopic.claim_count}</div>
                </div>
                <div className="rounded-3xl border border-border/70 bg-background/55 p-5">
                  <div className="text-sm text-muted-foreground">冲突数量</div>
                  <div className="mt-2 text-3xl font-black text-foreground">{selectedTopic.conflict_count}</div>
                </div>
                <div className="rounded-3xl border border-border/70 bg-background/55 p-5">
                  <div className="text-sm text-muted-foreground">待审核提案</div>
                  <div className="mt-2 text-3xl font-black text-foreground">{selectedTopic.proposals.filter((proposal) => proposal.status === "pending").length}</div>
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-[1.6rem] border border-border/70 bg-background/55 p-5">
                  <h2 className="text-lg font-black tracking-[-0.03em] text-foreground">最近事实</h2>
                  <div className="mt-3 space-y-2">
                    {selectedTopic.claims.slice(0, 4).length ? selectedTopic.claims.slice(0, 4).map((claim) => (
                      <button key={claim.id} className="w-full rounded-2xl border border-border/70 bg-card/70 p-3 text-left transition hover:border-primary/25" onClick={() => dispatch({ type: "SET_RESEARCH_SELECTED_CLAIM_ID", payload: claim.id })}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="line-clamp-2 text-sm font-semibold text-foreground">{claim.claim_text}</span>
                          <Badge variant="outline" className={`shrink-0 rounded-full ${statusTone(claim.status)}`}>{statusLabel(claim.status)}</Badge>
                        </div>
                      </button>
                    )) : <div className="rounded-2xl border border-dashed border-border/80 p-4 text-sm text-muted-foreground">暂无事实，点击更新图谱后会在这里展示可审核事实。</div>}
                  </div>
                </div>
                <div className="rounded-[1.6rem] border border-border/70 bg-background/55 p-5">
                  <h2 className="text-lg font-black tracking-[-0.03em] text-foreground">最近提案</h2>
                  <div className="mt-3 space-y-2">
                    {selectedTopic.proposals.slice(0, 4).length ? selectedTopic.proposals.slice(0, 4).map((proposal) => (
                      <div key={proposal.id} className="rounded-2xl border border-border/70 bg-card/70 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-foreground">{proposal.title}</div>
                          <Badge variant="outline" className={`rounded-full ${statusTone(proposal.status)}`}>{statusLabel(proposal.status)}</Badge>
                        </div>
                        {proposal.description && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{proposal.description}</p>}
                      </div>
                    )) : <div className="rounded-2xl border border-dashed border-border/80 p-4 text-sm text-muted-foreground">暂无更新提案。</div>}
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab === "claims" ? (
            <div className="space-y-3">
              {selectedTopic.claims.length ? selectedTopic.claims.map((claim) => {
                const evidence = evidenceForClaim(claim.id);
                const selected = state.researchSelectedClaimId === claim.id;
                return (
                  <div key={claim.id} className={`rounded-[1.6rem] border p-5 transition ${selected ? "border-primary/35 bg-primary/10" : "border-border/70 bg-background/55"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={`rounded-full ${statusTone(claim.status)}`}>{statusLabel(claim.status)}</Badge>
                          <Badge variant="outline" className="rounded-full">置信度 {claim.confidence}%</Badge>
                          {claim.adopted && <Badge className="rounded-full bg-emerald-600 text-white">已采用</Badge>}
                        </div>
                        <h2 className="text-base font-black leading-snug text-foreground">{claim.claim_text}</h2>
                        {claim.reasoning && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{claim.reasoning}</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {!claim.adopted && (
                          <Button size="sm" className="rounded-full" onClick={() => handleUpdateClaim(claim.id, { status: "supported", adopted: true })}>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            确认采用
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="rounded-full" onClick={() => handleUpdateClaim(claim.id, { status: "rejected", adopted: false })}>
                          <XCircle className="h-3.5 w-3.5" />
                          拒绝
                        </Button>
                        <Button size="sm" variant="ghost" className="rounded-full" onClick={() => handleUpdateClaim(claim.id, { status: "stale", adopted: false })}>标记过时</Button>
                      </div>
                    </div>
                    <div className="mt-4 rounded-2xl border border-border/70 bg-card/70 p-4">
                      <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">支持证据</div>
                      {evidence.length ? evidence.map((item) => {
                        const source = sourceForEvidence(item.source_id);
                        return (
                          <div key={item.id} className="mb-2 rounded-2xl bg-background/70 p-3 last:mb-0">
                            <p className="text-sm leading-relaxed text-foreground">“{item.quote}”</p>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                              <span>{item.kind}</span>
                              {item.location && <span>{item.location}</span>}
                              {source && <span>来源：{source.title}</span>}
                            </div>
                          </div>
                        );
                      }) : <div className="text-sm text-muted-foreground">暂无可追溯证据，不能确认成确定事实。</div>}
                    </div>
                  </div>
                );
              }) : <div className="rounded-[1.6rem] border border-dashed border-border/80 bg-background/45 p-8 text-center text-sm text-muted-foreground">暂无事实卡片。</div>}
            </div>
          ) : activeTab === "sources" ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {selectedTopic.sources.length ? selectedTopic.sources.map((source) => (
                <div key={source.id} className="rounded-[1.6rem] border border-border/70 bg-background/55 p-5">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className="rounded-full">{sourceTypeLabel(source.source_type)}</Badge>
                        <Badge variant="outline" className="rounded-full"><ShieldCheck className="h-3 w-3" />{trustLabel(source.trust_level)}</Badge>
                      </div>
                      <h2 className="mt-3 text-base font-black leading-snug text-foreground">{source.title}</h2>
                    </div>
                    {source.url && <a className="rounded-full border border-border/70 p-2 text-muted-foreground hover:text-primary" href={source.url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>}
                  </div>
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <span>发布者：{source.publisher || "未记录"}</span>
                    <span>发布时间：{formatDate(source.published_at)}</span>
                    <span>抓取时间：{formatDate(source.fetched_at)}</span>
                    <span>状态：{statusLabel(source.status)}</span>
                  </div>
                  {source.raw_excerpt && <p className="mt-3 line-clamp-3 rounded-2xl bg-card/70 p-3 text-sm leading-relaxed text-muted-foreground">{source.raw_excerpt}</p>}
                </div>
              )) : <div className="rounded-[1.6rem] border border-dashed border-border/80 bg-background/45 p-8 text-center text-sm text-muted-foreground lg:col-span-2">暂无来源。搜索摘要只能作为线索，最终来源需要可追溯正文或知识库原文。</div>}
            </div>
          ) : activeTab === "conflicts" ? (
            <div className="space-y-3">
              {conflictPairs.length ? conflictPairs.map(({ relation, fromClaim, toClaim, resolved, acceptedClaimId, rejectedClaimId }) => {
                const resolving = resolvingConflictId === relation.id;
                const canResolve = Boolean(fromClaim && toClaim && !resolved);

                return (
                  <div key={relation.id} className="rounded-[1.6rem] border border-destructive/25 bg-destructive/5 p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-bold text-destructive"><AlertCircle className="h-4 w-4" />冲突事实</div>
                      {resolved && <Badge className="rounded-full bg-emerald-600 text-white">已解决</Badge>}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-border/70 bg-card/75 p-4">
                        <Badge variant="outline" className="mb-2 rounded-full">事实 A</Badge>
                        <p className="text-sm font-semibold leading-relaxed text-foreground">{fromClaim?.claim_text ?? `Claim #${relation.from_id}`}</p>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-card/75 p-4">
                        <Badge variant="outline" className="mb-2 rounded-full">事实 B</Badge>
                        <p className="text-sm font-semibold leading-relaxed text-foreground">{toClaim?.claim_text ?? `Claim #${relation.to_id}`}</p>
                      </div>
                    </div>
                    {resolved ? (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="rounded-full border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">已采用 Claim #{acceptedClaimId ?? "-"}</Badge>
                        <Badge variant="outline" className="rounded-full border-destructive/25 bg-destructive/10 text-destructive">已拒绝 Claim #{rejectedClaimId ?? "-"}</Badge>
                      </div>
                    ) : (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          className="rounded-full"
                          disabled={!canResolve || resolving}
                          onClick={() => fromClaim && toClaim && handleResolveConflict(relation.id, fromClaim.id, toClaim.id)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {resolving ? "处理中..." : "接受 A / 拒绝 B"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full"
                          disabled={!canResolve || resolving}
                          onClick={() => fromClaim && toClaim && handleResolveConflict(relation.id, toClaim.id, fromClaim.id)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {resolving ? "处理中..." : "接受 B / 拒绝 A"}
                        </Button>
                      </div>
                    )}
                    <p className="mt-3 text-sm text-muted-foreground">写作时不要把冲突内容写成确定事实，应先解释冲突或补充检索。</p>
                    {!resolved && <p className="mt-2 text-xs text-muted-foreground">接受的一方会标记为已支持并采用；拒绝的一方会标记为已拒绝。</p>}
                  </div>
                );
              }) : <div className="rounded-[1.6rem] border border-dashed border-border/80 bg-background/45 p-8 text-center text-sm text-muted-foreground">暂无冲突关系。</div>}
            </div>
          ) : activeTab === "graph" ? (
            <ResearchGraphView topic={selectedTopic} />
          ) : (
            <div className="space-y-3">
              {!selectedProposal && (selectedTopic.proposals.length ? selectedTopic.proposals.map((proposal) => {
                  return (
                    <button
                      key={proposal.id}
                      type="button"
                      className="w-full rounded-[1.6rem] border border-border/70 bg-background/55 p-5 text-left transition hover:border-primary/30 hover:bg-background/75"
                      onClick={() => {
                        setProposalNote(null);
                        setConflictNote(null);
                        dispatch({ type: "SET_RESEARCH_SELECTED_PROPOSAL_ID", payload: proposal.id });
                      }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="mb-2 flex flex-wrap gap-2">
                            <Badge variant="outline" className="rounded-full">{proposal.proposal_type}</Badge>
                            <Badge variant="outline" className={`rounded-full ${statusTone(proposal.status)}`}>{statusLabel(proposal.status)}</Badge>
                          </div>
                          <h2 className="line-clamp-2 text-base font-black text-foreground">{proposal.title}</h2>
                        </div>
                        <div className="shrink-0 text-xs text-muted-foreground">{formatDate(proposal.created_at)}</div>
                      </div>
                      <p className="mt-3 text-xs font-semibold text-primary">{proposalOneLineSummary(proposal.payload_json)}</p>
                      {proposal.description && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{proposal.description}</p>}
                    </button>
                  );
                }) : <div className="rounded-[1.6rem] border border-dashed border-border/80 bg-background/45 p-8 text-center text-sm text-muted-foreground">暂无 Agent 更新提案。</div>)}

              {selectedProposal && (() => {
                const proposalSources = sourcesForProposal(selectedProposal);
                const proposalClaims = claimsForProposal(selectedProposal);
                const proposalConflicts = selectedProposal.payload_json ? conflictField(selectedProposal.payload_json) : [];
                const hasBatchClaims = selectedProposal.payload_json ? numberArrayField(selectedProposal.payload_json, "new_claims").length > 0 : false;
                const safeClaims = proposalClaims.filter(isClaimSafeForOneClickAdopt);
                const actionable = !["applied", "rejected"].includes(selectedProposal.status);

                return (
                  <div className="min-w-0 rounded-[1.8rem] border border-border/70 bg-background/55 p-5">
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mb-3 h-7 rounded-full px-2.5 text-xs"
                          onClick={() => dispatch({ type: "SET_RESEARCH_SELECTED_PROPOSAL_ID", payload: null })}
                        >
                          返回列表
                        </Button>
                        <div className="mb-2 flex flex-wrap gap-2">
                          <Badge variant="outline" className="rounded-full">{selectedProposal.proposal_type}</Badge>
                          <Badge variant="outline" className={`rounded-full ${statusTone(selectedProposal.status)}`}>{statusLabel(selectedProposal.status)}</Badge>
                        </div>
                        <h2 className="text-xl font-black tracking-[-0.03em] text-foreground">{selectedProposal.title}</h2>
                      </div>
                    </div>

                    <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                      <div className="rounded-2xl border border-border/60 bg-card/60 px-3 py-2">创建：{formatDate(selectedProposal.created_at)}</div>
                      <div className="rounded-2xl border border-border/60 bg-card/60 px-3 py-2">审核：{formatDate(selectedProposal.reviewed_at)}</div>
                      <div className="rounded-2xl border border-border/60 bg-card/60 px-3 py-2">应用：{formatDate(selectedProposal.applied_at)}</div>
                    </div>

                    {selectedProposal.description && <p className="mt-4 rounded-2xl border border-border/60 bg-card/60 p-4 text-sm leading-relaxed text-muted-foreground">{selectedProposal.description}</p>}
                    {selectedProposal.payload_json && <ProposalPayloadSummary payload={selectedProposal.payload_json} topic={selectedTopic} />}

                    {proposalSources.length > 0 && (
                      <div className="mt-5">
                        <h3 className="mb-2 text-sm font-black text-foreground">完整来源</h3>
                        <div className="space-y-2">
                          {proposalSources.map((source) => (
                            <div key={source.id} className="rounded-2xl border border-border/60 bg-card/60 p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="font-bold text-foreground">{source.title}</div>
                                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                    <span>{sourceTypeLabel(source.source_type)}</span>
                                    <span>· {trustLabel(source.trust_level)}</span>
                                    {source.publisher && <span>· {source.publisher}</span>}
                                    {source.published_at && <span>· {formatDate(source.published_at)}</span>}
                                  </div>
                                </div>
                                {(source.url || source.canonical_url) && (
                                  <a className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2.5 py-1 text-xs text-primary hover:bg-primary/10" href={source.url ?? source.canonical_url ?? undefined} target="_blank" rel="noreferrer">
                                    打开来源 <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
                              {source.raw_excerpt && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{source.raw_excerpt}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {proposalClaims.length > 0 && (
                      <div className="mt-5">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-black text-foreground">完整事实</h3>
                          <Badge variant="outline" className="rounded-full">可一键采用 {safeClaims.length} 条</Badge>
                        </div>
                        <div className="space-y-3">
                          {proposalClaims.map((claim) => {
                            const evidence = evidenceForClaim(claim.id);
                            const hasConflict = claimHasConflict(claim.id);
                            const riskNotes = [
                              hasConflict ? "存在冲突" : null,
                              claim.confidence < 70 ? "置信度低" : null,
                              evidence.length === 0 ? "缺少证据" : null,
                              ["rejected", "stale", "conflicted", "conflicting"].includes(claim.status) ? statusLabel(claim.status) : null,
                            ].filter(Boolean);

                            return (
                              <div key={claim.id} className="rounded-2xl border border-border/60 bg-card/60 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap gap-2">
                                      <Badge variant="outline" className={`rounded-full ${statusTone(claim.status)}`}>{statusLabel(claim.status)}</Badge>
                                      <Badge variant="outline" className="rounded-full">置信度 {claim.confidence}%</Badge>
                                      <Badge variant="outline" className={`rounded-full ${claim.adopted ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : ""}`}>{claim.adopted ? "已采用" : "未采用"}</Badge>
                                      {riskNotes.map((note) => <Badge key={note} variant="outline" className="rounded-full border-destructive/25 bg-destructive/10 text-destructive">{note}</Badge>)}
                                    </div>
                                    <p className="mt-3 text-sm font-semibold leading-relaxed text-foreground">{claim.claim_text}</p>
                                    {claim.reasoning && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{claim.reasoning}</p>}
                                  </div>
                                  {!claim.adopted && (
                                    <Button size="sm" className="rounded-full" onClick={() => handleAdoptProposalClaim(claim.id)}>
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      采用此事实
                                    </Button>
                                  )}
                                </div>

                                <div className="mt-4 space-y-2">
                                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">支持证据</div>
                                  {evidence.length ? evidence.map((item) => {
                                    const source = sourceForEvidence(item.source_id);
                                    return (
                                      <div key={item.id} className="rounded-xl bg-background/70 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                                        <div className="font-semibold text-foreground">“{item.quote}”</div>
                                        <div className="mt-1">{item.kind}{item.location ? ` · ${item.location}` : ""}{source ? ` · ${source.title}` : ""}</div>
                                      </div>
                                    );
                                  }) : <div className="rounded-xl border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">暂无支持证据，不能进入一键采用。</div>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {proposalConflicts.length > 0 && (
                      <div className="mt-5 rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
                        <h3 className="mb-2 flex items-center gap-2 text-sm font-black text-destructive"><AlertCircle className="h-4 w-4" />冲突信息</h3>
                        <div className="space-y-2">
                          {proposalConflicts.map((conflict, index) => (
                            <div key={`${conflict.between}-${index}`} className="rounded-xl bg-background/70 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                              <div className="font-semibold text-foreground">{conflict.between || `冲突 ${index + 1}`}</div>
                              {conflict.reason && <div className="mt-1">{conflict.reason}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {!selectedProposal.payload_json && (
                      <div className="mt-5 rounded-2xl border border-dashed border-border/80 p-4 text-sm text-muted-foreground">这条提案没有结构化明细，请根据标题和说明审核。</div>
                    )}

                    {actionable && (
                      <div className="mt-5 flex flex-wrap gap-2 border-t border-border/70 pt-4">
                        {hasBatchClaims ? (
                          <>
                            <Button size="sm" className="rounded-full" onClick={() => handleAdoptSafeProposalClaims(selectedProposal)}>
                              <ShieldCheck className="h-3.5 w-3.5" />
                              一键采用安全事实
                            </Button>
                            <Button variant="outline" size="sm" className="rounded-full" onClick={() => handleUpdateProposal(selectedProposal.id, "applied")}>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              标记提案已应用
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" className="rounded-full" onClick={() => handleUpdateProposal(selectedProposal.id, "applied")}>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            应用提案
                          </Button>
                        )}
                        <Button variant="outline" size="sm" className="rounded-full border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => handleUpdateProposal(selectedProposal.id, "rejected")}>
                          <XCircle className="h-3.5 w-3.5" />
                          拒绝提案
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
