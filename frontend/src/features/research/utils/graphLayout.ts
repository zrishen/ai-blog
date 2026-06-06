import { graphlib, layout } from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type { ResearchTopicDetail } from "@/api/client";

const NODE_SIZES = {
  source: { width: 240, height: 110 },
  evidence: { width: 260, height: 120 },
  claim: { width: 300, height: 130 },
  entity: { width: 220, height: 110 },
};

const NODE_TYPE_BY_RESEARCH_TYPE: Record<string, keyof typeof NODE_SIZES> = {
  source: "source",
  evidence: "evidence",
  claim: "claim",
  entity: "entity",
};

function nodeId(type: string, id: number) {
  return `${type}-${id}`;
}

function edgeTone(relationType: string) {
  if (relationType === "conflicts_with") return "#ef4444";
  if (["supports", "mentions", "derived_from"].includes(relationType)) return "#10b981";
  if (["outdated_by", "updates"].includes(relationType)) return "#f59e0b";
  return "#64748b";
}

export function buildResearchGraph(topic: ResearchTopicDetail): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    ...topic.sources.map((source): Node => ({
      id: nodeId("source", source.id),
      type: "sourceNode",
      position: { x: 0, y: 0 },
      data: { source },
    })),
    ...topic.evidence.map((evidence): Node => ({
      id: nodeId("evidence", evidence.id),
      type: "evidenceNode",
      position: { x: 0, y: 0 },
      data: { evidence, source: topic.sources.find((source) => source.id === evidence.source_id) ?? null },
    })),
    ...topic.claims.map((claim): Node => ({
      id: nodeId("claim", claim.id),
      type: "claimNode",
      position: { x: 0, y: 0 },
      data: { claim, entities: topic.entities.filter((entity) => claim.entity_ids.includes(entity.id)) },
    })),
    ...topic.entities.map((entity): Node => ({
      id: nodeId("entity", entity.id),
      type: "entityNode",
      position: { x: 0, y: 0 },
      data: { entity },
    })),
  ];

  const edgeByKey = new Map<string, Edge>();

  for (const relation of topic.relations) {
    const fromType = NODE_TYPE_BY_RESEARCH_TYPE[relation.from_type];
    const toType = NODE_TYPE_BY_RESEARCH_TYPE[relation.to_type];
    if (!fromType || !toType) continue;

    const source = nodeId(fromType, relation.from_id);
    const target = nodeId(toType, relation.to_id);
    if (!nodes.some((node) => node.id === source) || !nodes.some((node) => node.id === target)) continue;

    const key = `${source}->${target}:${relation.relation_type}`;
    edgeByKey.set(key, {
      id: `relation-${relation.id}`,
      source,
      target,
      label: relation.relation_type,
      animated: relation.relation_type === "conflicts_with",
      style: { stroke: edgeTone(relation.relation_type), strokeWidth: 1.8 },
      labelStyle: { fill: edgeTone(relation.relation_type), fontWeight: 700, fontSize: 11 },
    });
  }

  for (const link of topic.claim_entity_links) {
    const source = nodeId("claim", link.claim_id);
    const target = nodeId("entity", link.entity_id);
    if (!nodes.some((node) => node.id === source) || !nodes.some((node) => node.id === target)) continue;

    const key = `${source}->${target}:mentions`;
    if (!edgeByKey.has(key)) {
      edgeByKey.set(key, {
        id: `claim-entity-${link.id}`,
        source,
        target,
        label: "mentions",
        style: { stroke: edgeTone("mentions"), strokeWidth: 1.8 },
        labelStyle: { fill: edgeTone("mentions"), fontWeight: 700, fontSize: 11 },
      });
    }
  }

  const graph = new graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 110, marginx: 30, marginy: 30 });

  for (const node of nodes) {
    const researchType = node.type?.replace("Node", "") as keyof typeof NODE_SIZES;
    const size = NODE_SIZES[researchType] ?? NODE_SIZES.claim;
    graph.setNode(node.id, size);
  }

  for (const edge of edgeByKey.values()) {
    graph.setEdge(edge.source, edge.target);
  }

  layout(graph);

  const positionedNodes = nodes.map((node) => {
    const researchType = node.type?.replace("Node", "") as keyof typeof NODE_SIZES;
    const size = NODE_SIZES[researchType] ?? NODE_SIZES.claim;
    const position = graph.node(node.id);
    return {
      ...node,
      position: {
        x: position.x - size.width / 2,
        y: position.y - size.height / 2,
      },
      measured: size,
    };
  });

  const nodesByRank = new Map<number, typeof positionedNodes>();
  for (const node of positionedNodes) {
    const rank = Math.round(node.position.x / 80);
    nodesByRank.set(rank, [...(nodesByRank.get(rank) ?? []), node]);
  }

  for (const rankNodes of nodesByRank.values()) {
    rankNodes.sort((a, b) => a.position.y - b.position.y);
    let nextY = Number.NEGATIVE_INFINITY;
    for (const node of rankNodes) {
      const researchType = node.type?.replace("Node", "") as keyof typeof NODE_SIZES;
      const size = NODE_SIZES[researchType] ?? NODE_SIZES.claim;
      if (node.position.y < nextY) {
        node.position.y = nextY;
      }
      nextY = node.position.y + size.height + 36;
    }
  }

  return { nodes: positionedNodes, edges: [...edgeByKey.values()] };
}
