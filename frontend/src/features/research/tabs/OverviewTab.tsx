import { Badge } from "@/components/ui/badge";
import { SelectableSurface, Surface } from "@/components/ui/surface";
import { SectionTitle } from "@/components/ui/section-title";
import { useChatDispatch } from "../../../stores/chatStore";
import type { ResearchTopicDetail } from "../../../api/client";
import { statusBadgeVariant, statusLabel } from "../utils/researchFormat";

interface OverviewTabProps {
  topic: ResearchTopicDetail;
}

export function OverviewTab({ topic }: OverviewTabProps) {
  const dispatch = useChatDispatch();

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Surface variant="inset" className="rounded-panel p-5">
          <div className="text-body-lg text-muted-foreground">来源数量</div>
          <div className="mt-2 text-3xl font-black text-foreground">{topic.source_count}</div>
        </Surface>
        <Surface variant="inset" className="rounded-panel p-5">
          <div className="text-body-lg text-muted-foreground">事实数量</div>
          <div className="mt-2 text-3xl font-black text-foreground">{topic.claim_count}</div>
        </Surface>
        <Surface variant="inset" className="rounded-panel p-5">
          <div className="text-body-lg text-muted-foreground">冲突数量</div>
          <div className="mt-2 text-3xl font-black text-foreground">{topic.conflict_count}</div>
        </Surface>
        <Surface variant="inset" className="rounded-panel p-5">
          <div className="text-body-lg text-muted-foreground">待审核提案</div>
          <div className="mt-2 text-3xl font-black text-foreground">{topic.proposals.filter((proposal) => proposal.status === "pending").length}</div>
        </Surface>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Surface variant="inset" className="rounded-surface p-5">
          <SectionTitle size="lg">最近事实</SectionTitle>
          <div className="mt-3 space-y-2">
            {topic.claims.slice(0, 4).length ? topic.claims.slice(0, 4).map((claim) => (
              <SelectableSurface key={claim.id} className="w-full rounded-control bg-card/70 p-3 text-left" onClick={() => dispatch({ type: "SET_RESEARCH_SELECTED_CLAIM_ID", payload: claim.id })}>
                <div className="flex items-center justify-between gap-2">
                  <span className="line-clamp-2 text-body-lg font-semibold text-foreground">{claim.claim_text}</span>
                  <Badge variant={statusBadgeVariant(claim.status)} className="shrink-0 rounded-full">{statusLabel(claim.status)}</Badge>
                </div>
              </SelectableSurface>
            )) : <Surface variant="dashed" className="rounded-control p-4 text-sm">暂无事实，点击更新图谱后会在这里展示可审核事实。</Surface>}
          </div>
        </Surface>
        <Surface variant="inset" className="rounded-surface p-5">
          <SectionTitle size="lg">最近提案</SectionTitle>
          <div className="mt-3 space-y-2">
            {topic.proposals.slice(0, 4).length ? topic.proposals.slice(0, 4).map((proposal) => (
              <Surface key={proposal.id} variant="card" className="rounded-control bg-card/70 p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-foreground">{proposal.title}</div>
                  <Badge variant={statusBadgeVariant(proposal.status)} className="rounded-full">{statusLabel(proposal.status)}</Badge>
                </div>
                {proposal.description && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{proposal.description}</p>}
              </Surface>
            )) : <Surface variant="dashed" className="rounded-control p-4 text-sm">暂无更新提案。</Surface>}
          </div>
        </Surface>
      </div>
    </div>
  );
}
