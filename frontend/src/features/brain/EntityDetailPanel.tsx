import { Loader2, Pencil, Trash2 } from "lucide-react";

import { entityTypeColor } from "./utils/brainStyle";

import type { BrainFact, BrainGraphNode } from "@/api/brain";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function factStatus(fact: BrainFact): { label: string; tone: "success" | "warning" } {
  return fact.valid_to
    ? { label: "已失效", tone: "warning" }
    : { label: "有效", tone: "success" };
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

export function EntityDetailPanel({
  entity,
  facts,
  loading,
  onCorrectFact,
  onDeleteFact,
}: {
  entity: BrainGraphNode | null;
  facts: BrainFact[];
  loading: boolean;
  onCorrectFact: (fact: BrainFact) => void;
  onDeleteFact: (fact: BrainFact) => void;
}) {
  if (!entity) {
    return (
      <aside className="rounded-surface border border-border/70 bg-background/55 p-5 shadow-sm">
        <div className="text-body font-black text-foreground">图谱详情</div>
        <p className="mt-4 rounded-panel border border-dashed border-border/80 p-4 text-body leading-relaxed text-muted-foreground">
          点击实体节点查看它的属性、关联事实与时效状态。
        </p>
      </aside>
    );
  }

  const accent = entityTypeColor(entity.entity_type);
  return (
    <aside className="overflow-y-auto rounded-surface border border-border/70 bg-background/55 p-5 shadow-sm">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} aria-hidden />
        <div className="min-w-0">
          <div className="text-body-lg font-black leading-tight text-foreground">{entity.name}</div>
          <div className="mt-1 text-caption text-muted-foreground">{entity.entity_type ?? "实体"}</div>
        </div>
        <Badge variant="secondary" className="ml-auto shrink-0 rounded-full">
          {Math.round(entity.confidence * 100)}%
        </Badge>
      </div>

      <div className="mt-5 mb-2 text-meta font-bold uppercase tracking-[0.12em] text-muted-foreground">相关事实</div>
      {loading ? (
        <div className="flex items-center gap-2 text-fine text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载事实中…
        </div>
      ) : facts.length === 0 ? (
        <p className="rounded-panel border border-dashed border-border/80 p-3 text-fine text-muted-foreground">
          暂无关联事实。
        </p>
      ) : (
        <div className="space-y-2">
          {facts.map((f) => {
            const st = factStatus(f);
            const from = fmtDate(f.valid_from);
            return (
              <div key={f.fact_id} className="rounded-panel border border-border/60 bg-card/60 p-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="rounded-full text-caption">{f.predicate}</Badge>
                  <Badge variant={st.tone} className="rounded-full text-caption">{st.label}</Badge>
                  {from && <span className="text-caption text-muted-foreground">起 {from}</span>}
                </div>
                <p className="text-fine leading-relaxed text-foreground">{f.object_text}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="rounded-control text-meta" onClick={() => onCorrectFact(f)}>
                    <Pencil className="h-3.5 w-3.5" /> 纠正
                  </Button>
                  <Button variant="ghost" size="sm" className="rounded-control text-meta text-destructive hover:text-destructive" onClick={() => onDeleteFact(f)}>
                    <Trash2 className="h-3.5 w-3.5" /> 删除
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
