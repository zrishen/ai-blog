import { useCallback, useMemo, useState } from "react";
import { useChat } from "../../../stores/chatStore";
import {
  getResearchTopic,
  resolveResearchConflict,
  updateResearchClaim,
  updateResearchProposal,
} from "../../../api/client";
import type { ResearchTopicDetail } from "../../../api/client";
import {
  numberArrayField,
  type ConflictPair,
  type ResearchTopicClaim,
  type ResearchTopicProposal,
  type ResearchTopicSource,
} from "../utils/researchFormat";

export interface ResearchTopicActions {
  topicId: number | null;
  selectedTopic: ResearchTopicDetail | null;
  selectedProposal: ResearchTopicProposal | null;
  error: string | null;
  runNote: string | null;
  proposalNote: string | null;
  conflictNote: string | null;
  resolvingConflictId: number | null;
  setError: (value: string | null) => void;
  setRunNote: (value: string | null) => void;
  setProposalNote: (value: string | null) => void;
  setConflictNote: (value: string | null) => void;
  handleRunTopic: () => Promise<void>;
  handleUpdateClaim: (claimId: number, data: { status?: string; adopted?: boolean }) => Promise<void>;
  handleResolveConflict: (relationId: number, acceptedClaimId: number, rejectedClaimId: number) => Promise<void>;
  handleUpdateProposal: (proposalId: number, status: string) => Promise<void>;
  handleAdoptProposalClaim: (claimId: number) => Promise<void>;
  handleAdoptSafeProposalClaims: (proposal: ResearchTopicProposal) => Promise<void>;
  isClaimSafeForOneClickAdopt: (claim: ResearchTopicClaim) => boolean;
  claimHasConflict: (claimId: number) => boolean;
  claimsForProposal: (proposal: ResearchTopicProposal) => ResearchTopicClaim[];
  sourcesForProposal: (proposal: ResearchTopicProposal) => ResearchTopicSource[];
  evidenceForClaim: (claimId: number) => ResearchTopicDetail["evidence"];
  sourceForEvidence: (sourceId?: number | null) => ResearchTopicSource | null;
  conflictPairs: ConflictPair[];
}

export function useResearchTopicActions(): ResearchTopicActions {
  const { state, dispatch } = useChat();
  const [error, setError] = useState<string | null>(null);
  const [runNote, setRunNote] = useState<string | null>(null);
  const [proposalNote, setProposalNote] = useState<string | null>(null);
  const [conflictNote, setConflictNote] = useState<string | null>(null);
  const [resolvingConflictId, setResolvingConflictId] = useState<number | null>(null);

  const topicId = state.researchCurrentTopicId;
  const selectedTopic = state.researchCurrentTopic;

  const handleRunTopic = useCallback(async () => {
    if (!topicId) return;
    setError(null);
    setRunNote(null);
    setProposalNote(null);
    setConflictNote(null);
    try {
      const detail = await getResearchTopic(topicId);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
    } catch {
      /* ignore topic detail fetch errors */
    }
    dispatch({ type: "SET_AI_SIDEBAR_OPEN", payload: true });
    dispatch({ type: "SET_TRUST_WRITING_ENABLED", payload: true });
    dispatch({ type: "SET_PENDING_RESEARCH_PROMPT", payload: "open_research_choices" });
    setRunNote("已在右侧 AI 侧边栏显示研究写作选择，请选择继续研究、去图谱审核或不选择。");
  }, [dispatch, topicId]);

  const handleUpdateClaim = useCallback(async (claimId: number, data: { status?: string; adopted?: boolean }) => {
    if (!topicId) return;
    setError(null);
    setProposalNote(null);
    setConflictNote(null);
    try {
      await updateResearchClaim(claimId, data);
      const detail = await getResearchTopic(topicId);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
    } catch (err) {
      setError(err instanceof Error ? err.message : "事实审核失败");
    }
  }, [dispatch, topicId]);

  const handleResolveConflict = useCallback(async (relationId: number, acceptedClaimId: number, rejectedClaimId: number) => {
    if (!topicId) return;
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
      const detail = await getResearchTopic(topicId);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
      setConflictNote("冲突已解决，已采用的事实会进入可信写作上下文。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "冲突解决失败");
    } finally {
      setResolvingConflictId(null);
    }
  }, [dispatch, topicId]);

  const handleUpdateProposal = useCallback(async (proposalId: number, status: string) => {
    if (!topicId) return;
    const proposal = selectedTopic?.proposals.find((item) => item.id === proposalId);
    const batchClaimCount = proposal?.payload_json ? numberArrayField(proposal.payload_json, "new_claims").length : 0;
    const adoptedBefore = new Set((selectedTopic?.claims ?? []).filter((claim) => claim.adopted).map((claim) => claim.id));
    setError(null);
    setProposalNote(null);
    setConflictNote(null);
    try {
      await updateResearchProposal(proposalId, { status });
      const detail = await getResearchTopic(topicId);
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
  }, [dispatch, selectedTopic?.claims, selectedTopic?.proposals, topicId]);

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

  const conflictPairs = useMemo<ConflictPair[]>(() => selectedTopic?.relations
    .filter((relation) => relation.from_type === "claim" && relation.to_type === "claim" && relation.relation_type === "conflicts_with")
    .map((relation) => ({
      relation,
      fromClaim: selectedTopic.claims.find((claim) => claim.id === relation.from_id),
      toClaim: selectedTopic.claims.find((claim) => claim.id === relation.to_id),
      resolved: Boolean(relation.metadata_json?.resolved_at),
      acceptedClaimId: typeof relation.metadata_json?.accepted_claim_id === "number" ? relation.metadata_json.accepted_claim_id : null,
      rejectedClaimId: typeof relation.metadata_json?.rejected_claim_id === "number" ? relation.metadata_json.rejected_claim_id : null,
    })) ?? [], [selectedTopic]);

  const selectedProposal = selectedTopic?.proposals.find((proposal) => proposal.id === state.researchSelectedProposalId) ?? null;

  const claimHasConflict = useCallback((claimId: number) => {
    return conflictPairs.some(({ relation }) => relation.from_id === claimId || relation.to_id === claimId);
  }, [conflictPairs]);

  const claimsForProposal = useCallback((proposal: ResearchTopicProposal) => {
    if (!selectedTopic || !proposal.payload_json) return [];
    const claimIds = numberArrayField(proposal.payload_json, "new_claims");
    return claimIds.flatMap((id) => {
      const claim = selectedTopic.claims.find((item) => item.id === id);
      return claim ? [claim] : [];
    });
  }, [selectedTopic]);

  const sourcesForProposal = useCallback((proposal: ResearchTopicProposal) => {
    if (!selectedTopic || !proposal.payload_json) return [];
    const sourceIds = numberArrayField(proposal.payload_json, "new_sources");
    return sourceIds.flatMap((id) => {
      const source = selectedTopic.sources.find((item) => item.id === id);
      return source ? [source] : [];
    });
  }, [selectedTopic]);

  const isClaimSafeForOneClickAdopt = useCallback((claim: ResearchTopicClaim) => {
    if (claim.adopted) return false;
    if (["rejected", "stale", "conflicted", "conflicting"].includes(claim.status)) return false;
    if (claim.confidence < 70) return false;
    if (claimHasConflict(claim.id)) return false;
    return evidenceForClaim(claim.id).length > 0;
  }, [claimHasConflict, evidenceForClaim]);

  const handleAdoptProposalClaim = useCallback(async (claimId: number) => {
    if (!topicId) return;
    setError(null);
    setProposalNote(null);
    setConflictNote(null);
    try {
      await updateResearchClaim(claimId, { status: "supported", adopted: true });
      const detail = await getResearchTopic(topicId);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
      setProposalNote("已采用此事实。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "事实采用失败");
    }
  }, [dispatch, topicId]);

  const handleAdoptSafeProposalClaims = useCallback(async (proposal: ResearchTopicProposal) => {
    if (!topicId) return;
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
      const detail = await getResearchTopic(topicId);
      dispatch({ type: "SET_RESEARCH_CURRENT_TOPIC", payload: detail });
      setProposalNote(`已采用 ${safeClaims.length} 条安全事实；${manualCount} 条事实仍需人工确认。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "一键采用失败");
    }
  }, [claimsForProposal, dispatch, isClaimSafeForOneClickAdopt, topicId]);

  return {
    topicId,
    selectedTopic,
    selectedProposal,
    error,
    runNote,
    proposalNote,
    conflictNote,
    resolvingConflictId,
    setError,
    setRunNote,
    setProposalNote,
    setConflictNote,
    handleRunTopic,
    handleUpdateClaim,
    handleResolveConflict,
    handleUpdateProposal,
    handleAdoptProposalClaim,
    handleAdoptSafeProposalClaims,
    isClaimSafeForOneClickAdopt,
    claimHasConflict,
    claimsForProposal,
    sourcesForProposal,
    evidenceForClaim,
    sourceForEvidence,
    conflictPairs,
  };
}
