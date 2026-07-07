import { Badge } from "@/components/ui/badge";
import { useChat } from "../../../stores/chatStore";
import type { ResearchTopicDetail } from "../../../api/client";
import { statusLabel, statusTone } from "../utils/researchFormat";

interface OverviewTabProps {
  topic: ResearchTopicDetail;
}

export function OverviewTab({ topic }: OverviewTabProps) {
  const { dispatch } = useChat();

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-3xl border border-border/70 bg-background/55 p-5">
          <div className="text-[15px] text-muted-foreground">来源数量</div>
          <div className="mt-2 text-3xl font-black text-foreground">{topic.source_count}</div>
        </div>
        <div className="rounded-3xl border border-border/70 bg-background/55 p-5">
          <div className="text-[15px] text-muted-foreground">事实数量</div>
          <div className="mt-2 text-3xl font-black text-foreground">{topic.claim_count}</div>
        </div>
        <div className="rounded-3xl border border-border/70 bg-background/55 p-5">
          <div className="text-[15px] text-muted-foreground">冲突数量</div>
          <div className="mt-2 text-3xl font-black text-foreground">{topic.conflict_count}</div>
        </div>
        <div className="rounded-3xl border border-border/70 bg-background/55 p-5">
          <div className="text-[15px] text-muted-foreground">待审核提案</div>
          <div className="mt-2 text-3xl font-black text-foreground">{topic.proposals.filter((proposal) => proposal.status === "pending").length}</div>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-[1.6rem] border border-border/70 bg-background/55 p-5">
          <h2 className="text-lg font-black tracking-[-0.03em] text-foreground">最近事实</h2>
          <div className="mt-3 space-y-2">
            {topic.claims.slice(0, 4).length ? topic.claims.slice(0, 4).map((claim) => (
              <button key={claim.id} className="w-full rounded-2xl border border-border/70 bg-card/70 p-3 text-left transition hover:border-primary/25" onClick={() => dispatch({ type: "SET_RESEARCH_SELECTED_CLAIM_ID", payload: claim.id })}>
                <div className="flex items-center justify-between gap-2">
                  <span className="line-clamp-2 text-[15px] font-semibold text-foreground">{claim.claim_text}</span>
                  <Badge variant="outline" className={`shrink-0 rounded-full ${statusTone(claim.status)}`}>{statusLabel(claim.status)}</Badge>
                </div>
              </button>
            )) : <div className="rounded-2xl border border-dashed border-border/80 p-4 text-sm text-muted-foreground">暂无事实，点击更新图谱后会在这里展示可审核事实。</div>}
          </div>
        </div>
        <div className="rounded-[1.6rem] border border-border/70 bg-background/55 p-5">
          <h2 className="text-lg font-black tracking-[-0.03em] text-foreground">最近提案</h2>
          <div className="mt-3 space-y-2">
            {topic.proposals.slice(0, 4).length ? topic.proposals.slice(0, 4).map((proposal) => (
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
  );
}
