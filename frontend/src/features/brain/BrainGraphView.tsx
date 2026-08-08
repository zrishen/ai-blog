import { useMemo } from "react";
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { BrainCircuit } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { BrainEntityNode } from "./nodes/BrainEntityNode";
import { useForceLayout } from "./hooks/useForceLayout";
import { edgeTone } from "./utils/brainStyle";
import type { BrainGraph, BrainGraphNode } from "@/api/brain";

const nodeTypes = { brainEntity: BrainEntityNode };

export function BrainGraphView({
  graph,
  onSelect,
}: {
  graph: BrainGraph;
  onSelect: (node: BrainGraphNode | null) => void;
}) {
  // selected 不进 rawNodes 依赖，避免点选触发力导向重排（react-flow 内部自管选中态）。
  const rawNodes: Node[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: "brainEntity",
        position: { x: 0, y: 0 },
        data: { entity: n },
      })),
    [graph.nodes],
  );

  const rawEdges: Edge[] = useMemo(
    () =>
      graph.edges.map((e, i) => ({
        id: `e-${e.source}-${e.target}-${i}`,
        source: e.source,
        target: e.target,
        label: e.type,
        animated: e.type === "SAME_AS",
        style: { stroke: edgeTone(e.type), strokeWidth: 1.8 },
        labelStyle: { fill: edgeTone(e.type), fontWeight: 700, fontSize: 11 },
        labelBgStyle: { fill: "rgba(255,255,255,0.72)" },
      })),
    [graph.edges],
  );

  const { nodes, edges } = useForceLayout(rawNodes, rawEdges);

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={BrainCircuit}
          title="大脑还是空的"
          description="多和 AI 对话、或把文档加入知识库，AI 会自动抽取实体并织入这张星图。"
          className="rounded-surface"
        />
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.2}
      maxZoom={1.8}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => {
        const found = graph.nodes.find((n) => n.id === node.id) ?? null;
        onSelect(found);
      }}
      onPaneClick={() => onSelect(null)}
    >
      <MiniMap pannable zoomable nodeStrokeWidth={3} className="!hidden !bg-background/90 md:!block" />
      <Controls />
      <Background gap={22} size={1} />
    </ReactFlow>
  );
}
