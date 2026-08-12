import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useForceLayout } from "../../src/features/brain/hooks/useForceLayout";

import type { Edge, Node } from "@xyflow/react";

function node(id: string): Node {
  return { id, position: { x: 0, y: 0 }, data: {} };
}

describe("useForceLayout", () => {
  it("空节点返回原样", () => {
    const { result } = renderHook(() => useForceLayout([], []));
    expect(result.current.nodes).toEqual([]);
    expect(result.current.edges).toEqual([]);
  });

  it("单节点也产出确定位置", () => {
    const { result } = renderHook(() => useForceLayout([node("a")], []));
    expect(result.current.nodes).toHaveLength(1);
    const { x, y } = result.current.nodes[0].position;
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  });

  it("多个节点全部获得有限位置且互不重叠", () => {
    const nodes = ["a", "b", "c", "d", "e"].map(node);
    const edges: Edge[] = [
      { id: "ab", source: "a", target: "b" },
      { id: "bc", source: "b", target: "c" },
      { id: "de", source: "d", target: "e" },
    ];
    const { result } = renderHook(() => useForceLayout(nodes, edges, 900, 640));

    expect(result.current.nodes).toHaveLength(5);
    const positions = result.current.nodes.map((n) => n.position);
    for (const p of positions) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // 两两不重叠（至少距离 > 1，避免全挤在一点）
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        expect(Math.hypot(dx, dy)).toBeGreaterThan(1);
      }
    }
    // 原始数据（data）保留
    expect(result.current.nodes[0].data).toEqual({});
  });

  it("较大规模节点不产出 NaN（无卡死退化）", () => {
    const nodes = Array.from({ length: 120 }, (_, i) => node(`n${i}`));
    const edges: Edge[] = nodes.slice(1).map((n, i) => ({
      id: `e${i}`,
      source: nodes[i].id,
      target: n.id,
    }));
    const { result } = renderHook(() => useForceLayout(nodes, edges, 900, 640));
    for (const n of result.current.nodes) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
  });
});
