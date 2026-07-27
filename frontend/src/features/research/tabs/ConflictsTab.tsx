import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/surface";
import { EmptyState } from "@/components/ui/empty-state";
import type { ResearchTopicActions } from "../hooks/useResearchTopicActions";

interface ConflictsTabProps {
  actions: ResearchTopicActions;
}

export function ConflictsTab({ actions }: ConflictsTabProps) {
  const { conflictPairs, resolvingConflictId, handleResolveConflict } = actions;

  if (!conflictPairs.length) {
    return (
      <EmptyState title="暂无冲突关系" className="rounded-surface p-8" />
    );
  }

  return (
    <div className="space-y-3">
      {conflictPairs.map(({ relation, fromClaim, toClaim, resolved, acceptedClaimId, rejectedClaimId }) => {
        const resolving = resolvingConflictId === relation.id;
        const canResolve = Boolean(fromClaim && toClaim && !resolved);

        return (
          <div key={relation.id} className="rounded-surface border border-destructive/25 bg-destructive/5 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-destructive"><AlertCircle className="h-4 w-4" />冲突事实</div>
              {resolved && <Badge variant="success" solid className="rounded-full">已解决</Badge>}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Surface variant="card" className="rounded-control bg-card/75 p-4 shadow-sm">
                <Badge variant="outline" className="mb-2 rounded-full">事实 A</Badge>
                <p className="text-sm font-semibold leading-relaxed text-foreground">{fromClaim?.claim_text ?? `Claim #${relation.from_id}`}</p>
              </Surface>
              <Surface variant="card" className="rounded-control bg-card/75 p-4 shadow-sm">
                <Badge variant="outline" className="mb-2 rounded-full">事实 B</Badge>
                <p className="text-sm font-semibold leading-relaxed text-foreground">{toClaim?.claim_text ?? `Claim #${relation.to_id}`}</p>
              </Surface>
            </div>
            {resolved ? (
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="success" className="rounded-full">已采用 Claim #{acceptedClaimId ?? "-"}</Badge>
                <Badge variant="destructive" className="rounded-full">已拒绝 Claim #{rejectedClaimId ?? "-"}</Badge>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="rounded-full"
                  disabled={!canResolve || resolving}
                  onClick={() => fromClaim && toClaim && handleResolveConflict(relation.id, fromClaim.id, toClaim.id)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {resolving ? "处理中..." : "接受 A / 拒绝 B"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={!canResolve || resolving}
                  onClick={() => fromClaim && toClaim && handleResolveConflict(relation.id, toClaim.id, fromClaim.id)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {resolving ? "处理中..." : "接受 B / 拒绝 A"}
                </Button>
              </div>
            )}
            <p className="mt-3 text-sm text-muted-foreground">写作时不要把冲突内容写成确定事实，应先解释冲突或补充检索。</p>
            {!resolved && <p className="mt-2 text-xs text-muted-foreground">接受的一方会标记为已支持并采用；拒绝的一方会标记为已拒绝。</p>}
          </div>
        );
      })}
    </div>
  );
}
