import { AlertCircle, CheckCircle2, ExternalLink, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useChat } from "../../../stores/chatStore";
import type { ResearchTopicDetail } from "../../../api/client";
import type { ResearchTopicActions } from "../hooks/useResearchTopicActions";
import {
  conflictField,
  formatDate,
  numberArrayField,
  proposalOneLineSummary,
  sourceTypeLabel,
  statusLabel,
  statusTone,
  trustLabel,
} from "../utils/researchFormat";
import { ProposalPayloadSummary } from "./ProposalPayloadSummary";

interface ProposalsTabProps {
  topic: ResearchTopicDetail;
  actions: ResearchTopicActions;
}

export function ProposalsTab({ topic, actions }: ProposalsTabProps) {
  const { dispatch } = useChat();
  const {
    selectedProposal,
    claimsForProposal,
    sourcesForProposal,
    claimHasConflict,
    evidenceForClaim,
    sourceForEvidence,
    isClaimSafeForOneClickAdopt,
    handleUpdateProposal,
    handleAdoptProposalClaim,
    handleAdoptSafeProposalClaims,
    setProposalNote,
    setConflictNote,
  } = actions;

  if (selectedProposal) {
    return (
      <ProposalDetail
        topic={topic}
        proposal={selectedProposal}
        claimsForProposal={claimsForProposal}
        sourcesForProposal={sourcesForProposal}
        claimHasConflict={claimHasConflict}
        evidenceForClaim={evidenceForClaim}
        sourceForEvidence={sourceForEvidence}
        isClaimSafeForOneClickAdopt={isClaimSafeForOneClickAdopt}
        handleUpdateProposal={handleUpdateProposal}
        handleAdoptProposalClaim={handleAdoptProposalClaim}
        handleAdoptSafeProposalClaims={handleAdoptSafeProposalClaims}
        onBack={() => {
          setProposalNote(null);
          setConflictNote(null);
          dispatch({ type: "SET_RESEARCH_SELECTED_PROPOSAL_ID", payload: null });
        }}
      />
    );
  }

  if (!topic.proposals.length) {
    return (
      <div className="rounded-[1.6rem] border border-dashed border-border/80 bg-background/45 p-8 text-center text-sm text-muted-foreground">
        暂无 Agent 更新提案。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {topic.proposals.map((proposal) => (
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
            <div className="shrink-0 text-[13px] text-muted-foreground">{formatDate(proposal.created_at)}</div>
          </div>
          <p className="mt-3 text-[13px] font-semibold text-primary">{proposalOneLineSummary(proposal.payload_json)}</p>
          {proposal.description && <p className="mt-2 line-clamp-2 text-[15px] leading-relaxed text-muted-foreground">{proposal.description}</p>}
        </button>
      ))}
    </div>
  );
}

interface ProposalDetailProps {
  topic: ResearchTopicDetail;
  proposal: NonNullable<ResearchTopicActions["selectedProposal"]>;
  claimsForProposal: ResearchTopicActions["claimsForProposal"];
  sourcesForProposal: ResearchTopicActions["sourcesForProposal"];
  claimHasConflict: ResearchTopicActions["claimHasConflict"];
  evidenceForClaim: ResearchTopicActions["evidenceForClaim"];
  sourceForEvidence: ResearchTopicActions["sourceForEvidence"];
  isClaimSafeForOneClickAdopt: ResearchTopicActions["isClaimSafeForOneClickAdopt"];
  handleUpdateProposal: ResearchTopicActions["handleUpdateProposal"];
  handleAdoptProposalClaim: ResearchTopicActions["handleAdoptProposalClaim"];
  handleAdoptSafeProposalClaims: ResearchTopicActions["handleAdoptSafeProposalClaims"];
  onBack: () => void;
}

function ProposalDetail({
  topic,
  proposal,
  claimsForProposal,
  sourcesForProposal,
  claimHasConflict,
  evidenceForClaim,
  sourceForEvidence,
  isClaimSafeForOneClickAdopt,
  handleUpdateProposal,
  handleAdoptProposalClaim,
  handleAdoptSafeProposalClaims,
  onBack,
}: ProposalDetailProps) {
  const proposalSources = sourcesForProposal(proposal);
  const proposalClaims = claimsForProposal(proposal);
  const proposalConflicts = proposal.payload_json ? conflictField(proposal.payload_json) : [];
  const hasBatchClaims = proposal.payload_json ? numberArrayField(proposal.payload_json, "new_claims").length > 0 : false;
  const safeClaims = proposalClaims.filter(isClaimSafeForOneClickAdopt);
  const actionable = !["applied", "rejected"].includes(proposal.status);

  return (
    <div className="min-w-0 rounded-[1.8rem] border border-border/70 bg-background/55 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="mb-3 h-7 rounded-full px-2.5 text-xs"
            onClick={onBack}
          >
            返回列表
          </Button>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-full">{proposal.proposal_type}</Badge>
            <Badge variant="outline" className={`rounded-full ${statusTone(proposal.status)}`}>{statusLabel(proposal.status)}</Badge>
          </div>
          <h2 className="text-xl font-black tracking-[-0.03em] text-foreground">{proposal.title}</h2>
        </div>
      </div>

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div className="rounded-2xl border border-border/60 bg-card/60 px-3 py-2">创建：{formatDate(proposal.created_at)}</div>
        <div className="rounded-2xl border border-border/60 bg-card/60 px-3 py-2">审核：{formatDate(proposal.reviewed_at)}</div>
        <div className="rounded-2xl border border-border/60 bg-card/60 px-3 py-2">应用：{formatDate(proposal.applied_at)}</div>
      </div>

      {proposal.description && <p className="mt-4 rounded-2xl border border-border/60 bg-card/60 p-4 text-sm leading-relaxed text-muted-foreground">{proposal.description}</p>}
      {proposal.payload_json && <ProposalPayloadSummary payload={proposal.payload_json} topic={topic} />}

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
                          <div className="font-semibold text-foreground">"{item.quote}"</div>
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

      {!proposal.payload_json && (
        <div className="mt-5 rounded-2xl border border-dashed border-border/80 p-4 text-sm text-muted-foreground">这条提案没有结构化明细，请根据标题和说明审核。</div>
      )}

      {actionable && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-border/70 pt-4">
          {hasBatchClaims ? (
            <>
              <Button size="sm" className="rounded-full" onClick={() => handleAdoptSafeProposalClaims(proposal)}>
                <ShieldCheck className="h-3.5 w-3.5" />
                一键采用安全事实
              </Button>
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => handleUpdateProposal(proposal.id, "applied")}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                标记提案已应用
              </Button>
            </>
          ) : (
            <Button size="sm" className="rounded-full" onClick={() => handleUpdateProposal(proposal.id, "applied")}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              应用提案
            </Button>
          )}
          <Button variant="outline" size="sm" className="rounded-full border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => handleUpdateProposal(proposal.id, "rejected")}>
            <XCircle className="h-3.5 w-3.5" />
            拒绝提案
          </Button>
        </div>
      )}
    </div>
  );
}
