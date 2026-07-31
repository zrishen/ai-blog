import { ExternalLink, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/surface";
import { EmptyState } from "@/components/ui/empty-state";
import type { ResearchTopicDetail } from "../../../api/client";
import { formatDate, sourceTypeLabel, statusLabel, trustLabel } from "../utils/researchFormat";

interface SourcesTabProps {
  topic: ResearchTopicDetail;
}

export function SourcesTab({ topic }: SourcesTabProps) {
  if (!topic.sources.length) {
    return (
      <EmptyState
        title="暂无来源"
        description="搜索摘要只能作为线索，最终来源需要可追溯正文或知识库原文。"
        className="rounded-surface p-8 lg:col-span-2"
      />
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {topic.sources.map((source) => (
        <Surface key={source.id} variant="inset" className="rounded-surface p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="rounded-full">{sourceTypeLabel(source.source_type)}</Badge>
                <Badge variant="outline" className="rounded-full"><ShieldCheck className="h-3 w-3" />{trustLabel(source.trust_level)}</Badge>
              </div>
              <h2 className="mt-3 text-reading font-black leading-snug text-foreground">{source.title}</h2>
            </div>
            {source.url && <a className="rounded-full border border-border/70 p-2 text-muted-foreground hover:text-primary" href={source.url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>}
          </div>
          <div className="grid gap-2 text-fine text-muted-foreground sm:grid-cols-2">
            <span>发布者：{source.publisher || "未记录"}</span>
            <span>发布时间：{formatDate(source.published_at)}</span>
            <span>抓取时间：{formatDate(source.fetched_at)}</span>
            <span>状态：{statusLabel(source.status)}</span>
          </div>
          {source.raw_excerpt && <p className="mt-3 line-clamp-3 rounded-panel bg-card/70 p-3 text-body leading-relaxed text-muted-foreground">{source.raw_excerpt}</p>}
        </Surface>
      ))}
    </div>
  );
}
