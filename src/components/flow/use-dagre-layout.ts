import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

/** 各节点类型的固定尺寸（须与 flow-nodes.tsx 中的 CSS 尺寸一致） */
const NODE_SIZES: Record<string, { width: number; height: number }> = {
  roundSummary: { width: 304, height: 78 },
  userInput: { width: 304, height: 132 },
  llm: { width: 304, height: 148 },
  tool: { width: 284, height: 56 },
  answer: { width: 304, height: 118 },
};

function sizeOf(type: string | undefined): { width: number; height: number } {
  return NODE_SIZES[type ?? ""] ?? { width: 300, height: 80 };
}

/**
 * dagre 自上而下布局：节点须带固定尺寸，返回带坐标的节点数组。
 *
 * 注意：setNode 的 label 必须是每个节点独立的对象——dagre 布局时会
 * 直接在 label 上写入 x/y 坐标，若多个节点共享同一个尺寸对象，
 * 坐标会互相覆盖导致同类型节点全部重叠。
 */
export function layoutFlow<T extends Node>(nodes: T[], edges: Edge[]): T[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 48, ranksep: 56, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const size = sizeOf(node.type);
    g.setNode(node.id, { width: size.width, height: size.height });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const size = sizeOf(node.type);
    return {
      ...node,
      position: { x: pos.x - size.width / 2, y: pos.y - size.height / 2 },
    };
  });
}
