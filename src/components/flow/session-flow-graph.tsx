"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useReactFlow,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { useIsDark } from "@/lib/use-chart-colors";
import type { SessionDetail } from "@/components/trace/types";
import {
  buildSessionFlow,
  llmNodeId,
  type SessionFlowNodeData,
  type UserInputData,
} from "./build-flow-graph";
import { layoutFlow } from "./use-dagre-layout";
import {
  RoundSummaryNode,
  UserInputNode,
  LlmNode,
  ToolNode,
  AnswerNode,
} from "./flow-nodes";

const nodeTypes: NodeTypes = {
  roundSummary: RoundSummaryNode,
  userInput: UserInputNode,
  llm: LlmNode,
  tool: ToolNode,
  answer: AnswerNode,
};

/** 默认展开前 3 轮，其余折叠为摘要节点 */
const DEFAULT_EXPAND_ROUNDS = 3;

export function SessionFlowGraph({ detail }: { detail: SessionDetail }) {
  return (
    <ReactFlowProvider>
      <FlowCanvas detail={detail} />
    </ReactFlowProvider>
  );
}

function FlowCanvas({ detail }: { detail: SessionDetail }) {
  const { fitView } = useReactFlow();
  const isDark = useIsDark();

  const [expandedRoundIds, setExpandedRoundIds] = useState<Set<string>>(
    () => new Set(detail.rounds.slice(0, DEFAULT_EXPAND_ROUNDS).map((r) => r.id)),
  );
  const [expandedLlmIds, setExpandedLlmIds] = useState<Set<string>>(new Set());
  // 轮次级变更后触发 fitView（工具级展开不重置视口）
  const [fitNonce, setFitNonce] = useState(0);

  const collapseRound = useCallback((roundId: string) => {
    setExpandedRoundIds((prev) => {
      const next = new Set(prev);
      next.delete(roundId);
      return next;
    });
    setExpandedLlmIds((prev) => {
      const next = new Set(prev);
      next.delete(llmNodeId(roundId));
      return next;
    });
    setFitNonce((n) => n + 1);
  }, []);

  const { nodes, edges } = useMemo(() => {
    const built = buildSessionFlow(detail, {
      expandedRoundIds,
      expandedLlmIds,
    });
    const layouted = layoutFlow(built.nodes, built.edges);
    // 给用户输入节点挂收起回调（函数可存放于 data）
    for (const node of layouted) {
      if (node.data.type === "userInput") {
        (node.data as UserInputData).onCollapse = () => collapseRound(node.data.roundId);
      }
    }
    return { nodes: layouted, edges: built.edges };
  }, [detail, expandedRoundIds, expandedLlmIds, collapseRound]);

  useEffect(() => {
    if (fitNonce > 0) {
      fitView({ duration: 250, padding: 0.15, maxZoom: 1 });
    }
  }, [fitNonce, fitView]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const data = node.data as SessionFlowNodeData;
      if (data.type === "roundSummary") {
        setExpandedRoundIds((prev) => new Set(prev).add(data.roundId));
        setFitNonce((n) => n + 1);
      } else if (data.type === "llm") {
        setExpandedLlmIds((prev) => {
          const next = new Set(prev);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
      }
    },
    [],
  );

  const expandAll = useCallback(() => {
    setExpandedRoundIds(new Set(detail.rounds.map((r) => r.id)));
    setFitNonce((n) => n + 1);
  }, [detail]);

  const collapseAll = useCallback(() => {
    setExpandedRoundIds(new Set());
    setExpandedLlmIds(new Set());
    setFitNonce((n) => n + 1);
  }, []);

  return (
    <div className="relative h-full w-full">
      {/* 工具栏 */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-card/90 p-1 shadow-sm backdrop-blur-sm">
        <span className="hidden px-2 text-xs text-muted-foreground lg:inline">
          点击节点展开 · 点击 LLM 框展开工具调用
          {detail.forkCount > 0 ? " · 含分支，完整结构见树形视图" : ""}
        </span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={expandAll}>
          全部展开
        </Button>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={collapseAll}>
          全部收起
        </Button>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={2}
        colorMode={isDark ? "dark" : "light"}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
