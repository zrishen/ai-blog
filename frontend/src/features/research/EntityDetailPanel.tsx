import { ExternalLink, Network } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/surface";
import { surfaceVariants } from "@/lib/visualVariants";
import { cn } from "@/lib/utils";
import type { ResearchEntity, ResearchTopicDetail } from "@/api/client";

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "待审核",
    supported: "已支持",
    conflicting: "有冲突",
    rejected: "已拒绝",
    active: "活跃",
    inactive: "停用",
    disputed: "有争议",
  };
  return labels[status] ?? status;
}

function relationEndpointLabel(topic: ResearchTopicDetail, type: string, id: number) {
  if (type === "entity") return topic.entities.find((item) => item.id === id)?.name ?? `实体 #${id}`;
  if (type === "claim") return topic.claims.find((item) => item.id === id)?.claim_text ?? `事实 #${id}`;
  if (type === "evidence") return topic.evidence.find((item) => item.id === id)?.quote ?? `证据 #${id}`;
  if (type === "source") return topic.sources.find((item) => item.id === id)?.title ?? `来源 #${id}`;
  return `${type} #${id}`;
}

export function EntityDetailPanel({ entity, topic }: { entity: ResearchEntity; topic: ResearchTopicDetail }) {
  const relatedClaimIds = new Set(
    topic.claim_entity_links
      .filter((link) => link.entity_id === entity.id)
      .map((link) => link.claim_id),
  );
  const relatedClaims = topic.claims.filter((claim) => relatedClaimIds.has(claim.id));
  const evidenceIds = new Set(
    topic.relations
      .filter((relation) => relation.to_type === "claim" && relatedClaimIds.has(relation.to_id) && relation.from_type === "evidence")
      .map((relation) => relation.from_id),
  );
  const relatedEvidence = topic.evidence.filter((item) => evidenceIds.has(item.id));
  const relatedSourceIds = new Set(relatedEvidence.flatMap((item) => item.source_id ? [item.source_id] : []));
  const relatedSources = topic.sources.filter((source) => relatedSourceIds.has(source.id));
  const conflicts = topic.relations.filter((relation) => (
    relation.relation_type === "conflicts_with" &&
    relation.from_type === "claim" &&
    relation.to_type === "claim" &&
    (relatedClaimIds.has(relation.from_id) || relatedClaimIds.has(relation.to_id))
  ));
  const relatedRelations = topic.relations.filter((relation) => (
    (relation.from_type === "entity" && relation.from_id === entity.id) ||
    (relation.to_type === "entity" && relation.to_id === entity.id) ||
    (relation.from_type === "claim" && relatedClaimIds.has(relation.from_id)) ||
    (relation.to_type === "claim" && relatedClaimIds.has(relation.to_id))
  ));

  return (
    <aside className={cn(surfaceVariants({ variant: "inset" }), "h-full min-h-[420px] overflow-hidden rounded-surface bg-background/75 shadow-sm")}>
      <div className="border-b border-border/70 p-5">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground"><Network className="h-3.5 w-3.5" />实体详情</div>
        <h2 className="text-xl font-black tracking-[-0.03em] text-foreground">{entity.name}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="outline" className="rounded-full">{entity.entity_type || "entity"}</Badge>
          <Badge variant="outline" className="rounded-full">置信度 {entity.confidence}%</Badge>
          <Badge variant="outline" className="rounded-full">{statusLabel(entity.status)}</Badge>
        </div>
        {entity.description && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{entity.description}</p>}
      </div>

      <div className="max-h-[560px] space-y-5 overflow-y-auto p-5">
        <section>
          <h3 className="mb-2 text-sm font-black text-foreground">相关事实</h3>
          <div className="space-y-2">
            {relatedClaims.length ? relatedClaims.map((claim) => (
              <Surface key={claim.id} variant="card" className="rounded-control bg-card/60 p-3 shadow-sm">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="rounded-full text-[10px]">{statusLabel(claim.status)}</Badge>
                  <Badge variant="outline" className="rounded-full text-[10px]">{claim.confidence}%</Badge>
                </div>
                <p className="text-xs font-semibold leading-relaxed text-foreground">{claim.claim_text}</p>
              </Surface>
            )) : <Surface variant="dashed" className="rounded-control p-3 text-xs">暂无直接绑定的事实。</Surface>}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-black text-foreground">相关来源</h3>
          <div className="space-y-2">
            {relatedSources.length ? relatedSources.map((source) => (
              <Surface key={source.id} variant="card" className="rounded-control bg-card/60 p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-xs font-semibold leading-relaxed text-foreground">{source.title}</div>
                  {(source.url || source.canonical_url) && (
                    <a className="shrink-0 text-primary" href={source.url ?? source.canonical_url ?? undefined} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground">{source.source_type} · {source.trust_level}</div>
              </Surface>
            )) : <Surface variant="dashed" className="rounded-control p-3 text-xs">暂无可追溯来源。</Surface>}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-black text-foreground">冲突</h3>
          <div className="space-y-2">
            {conflicts.length ? conflicts.map((relation) => (
              <div key={relation.id} className="rounded-2xl border border-destructive/25 bg-destructive/5 p-3 text-xs leading-relaxed text-muted-foreground">
                <div className="font-semibold text-foreground">{relationEndpointLabel(topic, relation.from_type, relation.from_id)}</div>
                <div className="my-1 font-bold text-destructive">conflicts_with</div>
                <div className="font-semibold text-foreground">{relationEndpointLabel(topic, relation.to_type, relation.to_id)}</div>
              </div>
            )) : <Surface variant="dashed" className="rounded-control p-3 text-xs">暂无关联冲突。</Surface>}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-black text-foreground">关系</h3>
          <div className="space-y-2">
            {relatedRelations.length ? relatedRelations.map((relation) => (
              <Surface key={relation.id} variant="card" className="rounded-control bg-card/60 p-3 text-xs leading-relaxed shadow-sm">
                <span className="font-semibold text-foreground">{relationEndpointLabel(topic, relation.from_type, relation.from_id)}</span>
                <span className="mx-1.5 text-primary">{relation.relation_type}</span>
                <span className="font-semibold text-foreground">{relationEndpointLabel(topic, relation.to_type, relation.to_id)}</span>
              </Surface>
            )) : <Surface variant="dashed" className="rounded-control p-3 text-xs">暂无关系。</Surface>}
          </div>
        </section>
      </div>
    </aside>
  );
}
