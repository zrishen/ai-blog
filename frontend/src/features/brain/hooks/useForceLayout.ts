import { useMemo } from "react";

import type { Edge, Node } from "@xyflow/react";

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * 轻量力导向布局（Fruchterman-Reingold 简化版）：弹簧吸引 + 库仑排斥 + 中心引力 + 退火。
 * 不引入 d3-force 依赖，对个人记忆图谱（≤ ~120 节点）收敛稳定。
 * Obsidian/Roam 式星图：数据变化时重算一次（useMemo），不持续动画——展示收敛后的静态布局。
 */
export function useForceLayout(
  rawNodes: Node[],
  rawEdges: Edge[],
  width = 900,
  height = 640,
): { nodes: Node[]; edges: Edge[] } {
  return useMemo(() => {
    if (rawNodes.length === 0) return { nodes: rawNodes, edges: rawEdges };

    const area = width * height;
    const k = Math.sqrt(area / rawNodes.length);
    const pos = new Map<string, SimNode>();
    // 圆形初始化（避免重叠起点，加速收敛）
    rawNodes.forEach((n, i) => {
      const angle = (i / rawNodes.length) * 2 * Math.PI;
      pos.set(n.id, {
        id: n.id,
        x: width / 2 + Math.cos(angle) * k * 1.8,
        y: height / 2 + Math.sin(angle) * k * 1.8,
        vx: 0,
        vy: 0,
      });
    });

    const iterations = Math.min(420, 140 + rawNodes.length * 3);
    let temperature = width / 8;
    const centerGravity = 0.012;

    for (let iter = 0; iter < iterations; iter++) {
      // 排斥力（库仑）+ 中心引力
      for (const a of rawNodes) {
        const pa = pos.get(a.id);
        let fx = 0;
        let fy = 0;
        for (const b of rawNodes) {
          if (a.id === b.id) continue;
          const pb = pos.get(b.id);
          const dx = pa.x - pb.x;
          const dy = pa.y - pb.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const force = (k * k) / dist;
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }
        fx += (width / 2 - pa.x) * centerGravity;
        fy += (height / 2 - pa.y) * centerGravity;
        pa.vx = fx;
        pa.vy = fy;
      }
      // 吸引力（弹簧，沿边）
      for (const e of rawEdges) {
        const pa = pos.get(e.source);
        const pb = pos.get(e.target);
        if (!pa || !pb) continue;
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const force = (dist * dist) / k;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        pa.vx -= fx;
        pa.vy -= fy;
        pb.vx += fx;
        pb.vy += fy;
      }
      // 应用位移（受温度限制）+ 软边界
      for (const n of rawNodes) {
        const p = pos.get(n.id);
        const disp = Math.hypot(p.vx, p.vy) || 0.01;
        p.x += (p.vx / disp) * Math.min(disp, temperature);
        p.y += (p.vy / disp) * Math.min(disp, temperature);
        p.x = Math.max(40, Math.min(width - 40, p.x));
        p.y = Math.max(40, Math.min(height - 40, p.y));
      }
      temperature *= 0.97;
    }

    const placed = rawNodes.map((n) => {
      const p = pos.get(n.id);
      return { ...n, position: { x: p.x, y: p.y } };
    });
    return { nodes: placed, edges: rawEdges };
  }, [rawNodes, rawEdges, width, height]);
}
