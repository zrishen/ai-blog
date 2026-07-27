import { useMemo, useState } from "react";
import { Background, Controls, MiniMap, ReactFlow, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/section-title";
import type { ResearchTopicDetail } from "@/api/client";
import { EntityDetailPanel } from "./EntityDetailPanel";
import { ClaimNode } from "./nodes/ClaimNode";
import { EntityNode } from "./nodes/EntityNode";
import { EvidenceNode } from "./nodes/EvidenceNode";
import { SourceNode } from "./nodes/SourceNode";
import { buildResearchGraph } from "./utils/graphLayout";

const nodeTypes = {
  sourceNode: SourceNode,
  evidenceNode: EvidenceNode,
  claimNode: ClaimNode,
  entityNode: EntityNode,
};

function parseNodeId(node: Node) {
  const [type, id] = node.id.split("-");
  return { type, id: Number(id) };
}

export function ResearchGraphView({ topic }: { topic: ResearchTopicDetail }) {
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const [selectedClaimId, setSelectedClaimId] = useState<number | null>(null);
  const { nodes, edges } = useMemo(() => buildResearchGraph(topic), [topic]);
  const selectedEntity = topic.entities.find((entity) => entity.id === selectedEntityId) ?? null;
  const selectedClaim = topic.claims.find((claim) => claim.id === selectedClaimId) ?? null;
  const hasGraph = nodes.length > 0;

  return (
    <div className="grid gap-4 sm:min-h-[680px] xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="overflow-hidden rounded-shell border border-border/70 bg-background/55 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 p-3 sm:p-4">
          <div>
            <SectionTitle size="lg">研究图谱</SectionTitle>
            <p className="mt-1 text-sm text-muted-foreground">展示来源、证据、事实和实体之间的可追溯关系。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-full">来源 {topic.sources.length}</Badge>
            <Badge variant="outline" className="rounded-full">证据 {topic.evidence.length}</Badge>
            <Badge variant="outline" className="rounded-full">事实 {topic.claims.length}</Badge>
            <Badge variant="outline" className="rounded-full">实体 {topic.entities.length}</Badge>
          </div>
        </div>

        <div className="h-[min(62dvh,520px)] min-h-[360px] bg-muted/15 sm:h-[600px]">
          {hasGraph ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.18 }}
              minZoom={0.2}
              maxZoom={1.6}
              onNodeClick={(_, node) => {
                const parsed = parseNodeId(node);
                setSelectedEntityId(parsed.type === "entity" ? parsed.id : null);
                setSelectedClaimId(parsed.type === "claim" ? parsed.id : null);
              }}
              onPaneClick={() => {
                setSelectedEntityId(null);
                setSelectedClaimId(null);
              }}
            >
              <MiniMap pannable zoomable nodeStrokeWidth={3} className="!hidden !bg-background/90 md:!block" />
              <Controls />
              <Background gap={22} size={1} />
            </ReactFlow>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
              暂无可视化节点。运行研究或添加来源、证据、事实、实体后会生成图谱。
            </div>
          )}
        </div>
      </div>

      {selectedEntity ? (
        <EntityDetailPanel entity={selectedEntity} topic={topic} />
      ) : (
        <aside className="rounded-surface border border-border/70 bg-background/55 p-5 shadow-sm">
          <div className="text-sm font-black text-foreground">图谱详情</div>
          {selectedClaim ? (
            <div className="mt-4 rounded-panel border border-border/60 bg-card/60 p-4">
              <div className="mb-2 flex flex-wrap gap-2">
                <Badge variant="outline" className="rounded-full">{selectedClaim.status}</Badge>
                <Badge variant="outline" className="rounded-full">置信度 {selectedClaim.confidence}%</Badge>
              </div>
              <p className="text-sm font-semibold leading-relaxed text-foreground">{selectedClaim.claim_text}</p>
              {selectedClaim.reasoning && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{selectedClaim.reasoning}</p>}
            </div>
          ) : (
            <div className="mt-4 rounded-panel border border-dashed border-border/80 p-4 text-sm leading-relaxed text-muted-foreground">
              点击实体节点查看相关事实、来源、冲突和关系；点击事实节点可查看事实摘要。
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
