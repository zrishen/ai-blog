import { Badge } from "@/components/ui/badge";
import type { ResearchTopicDetail } from "../../../api/client";
import {
  conflictField,
  numberArrayField,
  numberField,
  sourceTypeLabel,
  statusLabel,
  trustLabel,
} from "../utils/researchFormat";

interface ProposalPayloadSummaryProps {
  payload: Record<string, unknown>;
  topic: ResearchTopicDetail;
}

export function ProposalPayloadSummary({ payload, topic }: ProposalPayloadSummaryProps) {
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
        {conflicts.length > 0 && <Badge variant="destructive" className="rounded-full">发现冲突 {conflicts.length} 个</Badge>}
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
