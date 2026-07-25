import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SOFT_SELECTED_SURFACE } from "@/lib/selectionStyles";
import { useChat } from "../../../stores/chatStore";
import type { ResearchTopicDetail } from "../../../api/client";
import type { ResearchTopicActions } from "../hooks/useResearchTopicActions";
import { statusLabel, statusTone } from "../utils/researchFormat";

interface ClaimsTabProps {
  topic: ResearchTopicDetail;
  actions: ResearchTopicActions;
}

export function ClaimsTab({ topic, actions }: ClaimsTabProps) {
  const { state } = useChat();
  const { handleUpdateClaim, evidenceForClaim, sourceForEvidence } = actions;

  if (!topic.claims.length) {
    return (
      <div className="rounded-[1.6rem] border border-dashed border-border/80 bg-background/45 p-8 text-center text-sm text-muted-foreground">
        暂无事实卡片。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {topic.claims.map((claim) => {
        const evidence = evidenceForClaim(claim.id);
        const selected = state.researchSelectedClaimId === claim.id;
        return (
          <div key={claim.id} className={`rounded-[1.6rem] border p-5 transition ${selected ? SOFT_SELECTED_SURFACE : "border-border/70 bg-background/55"}`}>
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
                    <p className="text-sm leading-relaxed text-foreground">"{item.quote}"</p>
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
      })}
    </div>
  );
}
