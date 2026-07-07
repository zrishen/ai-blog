import { ExternalLink, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ResearchTopicDetail } from "../../../api/client";
import { formatDate, sourceTypeLabel, statusLabel, trustLabel } from "../utils/researchFormat";

interface SourcesTabProps {
  topic: ResearchTopicDetail;
}

export function SourcesTab({ topic }: SourcesTabProps) {
  if (!topic.sources.length) {
    return (
      <div className="rounded-[1.6rem] border border-dashed border-border/80 bg-background/45 p-8 text-center text-sm text-muted-foreground lg:col-span-2">
        暂无来源。搜索摘要只能作为线索，最终来源需要可追溯正文或知识库原文。
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {topic.sources.map((source) => (
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
      ))}
    </div>
  );
}
