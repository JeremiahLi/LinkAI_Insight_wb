import type { Edge, Node } from "@xyflow/react";
import type { RoundNode, SessionDetail, SpanNode } from "@/components/trace/types";
import { isSkillSpan, getSkillName } from "@/components/trace/span-kind-icon";

/**
 * SessionDetail → React Flow 节点/边的纯函数映射。
 *
 * 两级展开：
 * - 轮次折叠（roundSummary）：单节点摘要，点击展开
 * - 轮次展开（userInput → llm → [tool...] → answer）：点击 LLM 节点再展开该轮工具调用序列
 */

// ---------- 节点数据类型 ----------

export type RoundSummaryData = {
  type: "roundSummary";
  roundId: string;
  roundIndex: number;
  inputPreview: string;
  tokens: number;
  duration: number;
  turnCount: number;
  toolCount: number;
  isFork: boolean;
};

export type UserInputData = {
  type: "userInput";
  roundId: string;
  roundIndex: number;
  text: string;
  charCount: number;
  onCollapse?: () => void;
};

export type LlmData = {
  type: "llm";
  roundId: string;
  roundIndex: number;
  model: string;
  duration: number;
  tokens: number;
  outputPreview: string;
  toolCount: number;
  expanded: boolean;
};

export type ToolData = {
  type: "tool";
  roundId: string;
  roundIndex: number;
  name: string;
  isSkill: boolean;
  status: string;
  duration: number;
  tokens: number;
  error?: string;
};

export type AnswerData = {
  type: "answer";
  roundId: string;
  roundIndex: number;
  outputPreview: string;
  tokens: number;
};

export type SessionFlowNodeData =
  | RoundSummaryData
  | UserInputData
  | LlmData
  | ToolData
  | AnswerData;

export type SessionFlowNode = Node<SessionFlowNodeData>;

export interface BuildFlowOptions {
  expandedRoundIds: Set<string>;
  expandedLlmIds: Set<string>;
}

/** LLM 节点 id 规则（供展开状态与点击处理共用） */
export function llmNodeId(roundId: string): string {
  return `l-${roundId}`;
}

// ---------- 工具函数 ----------

function preview(text: string | undefined, max: number): string {
  if (!text) return "";
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function isToolSpan(s: SpanNode): boolean {
  return s.kind === "tool_call" || s.kind === "tool_execution";
}

function spanDuration(s: SpanNode): number {
  if (s.kind === "tool_call" && s.toolDuration != null) return s.toolDuration;
  if ((s.kind === "llm_thinking" || s.kind === "answer") && s.agentReplyDuration != null) return s.agentReplyDuration;
  return s.duration;
}

function sumTokens(spans: SpanNode[]): number {
  return spans.reduce((acc, s) => acc + (s.tokens?.total ?? 0), 0);
}

function answerNode(round: RoundNode): SessionFlowNode | null {
  if (!round.answerSpan) return null;
  return {
    id: `a-${round.id}`,
    type: "answer",
    position: { x: 0, y: 0 },
    data: {
      type: "answer",
      roundId: round.id,
      roundIndex: round.index,
      outputPreview: preview(round.answerSpan.output, 160),
      tokens: round.answerSpan.tokens?.total ?? 0,
    },
  };
}

// ---------- 主构建函数 ----------

export function buildSessionFlow(
  detail: SessionDetail,
  options: BuildFlowOptions,
): { nodes: SessionFlowNode[]; edges: Edge[] } {
  const nodes: SessionFlowNode[] = [];
  const edges: Edge[] = [];
  let prev: string | null = null;

  const link = (source: string, target: string) => {
    edges.push({ id: `e-${source}-${target}`, source, target });
  };

  for (const round of detail.rounds) {
    const spans = round.turns.flatMap((t) => t.spans);
    const toolSpans = spans.filter(isToolSpan);

    // ---- 折叠轮次：单摘要节点 ----
    if (!options.expandedRoundIds.has(round.id)) {
      const id = `rs-${round.id}`;
      const allSpans = round.answerSpan ? [...spans, round.answerSpan] : spans;
      nodes.push({
        id,
        type: "roundSummary",
        position: { x: 0, y: 0 },
        data: {
          type: "roundSummary",
          roundId: round.id,
          roundIndex: round.index,
          inputPreview: preview(round.inputSpan?.input, 80),
          tokens: sumTokens(allSpans),
          duration: allSpans.reduce((acc, s) => acc + spanDuration(s), 0),
          turnCount: round.turns.length,
          toolCount: toolSpans.length,
          isFork: !!round.isForkPoint,
        },
      });
      if (prev) link(prev, id);
      prev = id;
      continue;
    }

    // ---- 展开轮次：user → llm → [tools] → answer ----
    const llmSpans = spans.filter((s) => s.kind === "llm_thinking");

    // 用户输入节点
    const userId = `u-${round.id}`;
    const inputText = round.inputSpan?.input ?? "";
    nodes.push({
      id: userId,
      type: "userInput",
      position: { x: 0, y: 0 },
      data: {
        type: "userInput",
        roundId: round.id,
        roundIndex: round.index,
        text: inputText,
        charCount: inputText.length,
      },
    });
    if (prev) link(prev, userId);

    // 无 LLM 记录且无工具：直接连回答（或结束本轮）
    if (llmSpans.length === 0 && toolSpans.length === 0) {
      const aNode = answerNode(round);
      if (aNode) {
        nodes.push(aNode);
        link(userId, aNode.id);
        prev = aNode.id;
      } else {
        prev = userId;
      }
      continue;
    }

    // LLM 节点（聚合该轮全部 llm_thinking）
    const lid = llmNodeId(round.id);
    const llmExpanded = options.expandedLlmIds.has(lid);
    const lastLlm = llmSpans[llmSpans.length - 1];
    nodes.push({
      id: lid,
      type: "llm",
      position: { x: 0, y: 0 },
      data: {
        type: "llm",
        roundId: round.id,
        roundIndex: round.index,
        model: llmSpans.find((s) => s.model)?.model || detail.model || "—",
        duration: llmSpans.reduce((acc, s) => acc + (s.llmThinkDuration ?? s.duration), 0),
        tokens: sumTokens(llmSpans),
        outputPreview: preview(lastLlm?.output, 160),
        toolCount: toolSpans.length,
        expanded: llmExpanded,
      },
    });
    link(userId, lid);

    // 展开的工具序列
    let cursor = lid;
    if (llmExpanded) {
      toolSpans.forEach((span, i) => {
        const tid = `t-${round.id}-${i}`;
        nodes.push({
          id: tid,
          type: "tool",
          position: { x: 0, y: 0 },
          data: {
            type: "tool",
            roundId: round.id,
            roundIndex: round.index,
            name: isSkillSpan(span) ? getSkillName(span) : span.name,
            isSkill: isSkillSpan(span),
            status: span.status,
            duration: spanDuration(span),
            tokens: span.tokens?.total ?? 0,
            error: span.error,
          },
        });
        link(cursor, tid);
        cursor = tid;
      });
    }

    // 回答节点 → 下一轮
    const aNode = answerNode(round);
    if (aNode) {
      nodes.push(aNode);
      link(cursor, aNode.id);
      prev = aNode.id;
    } else {
      prev = cursor;
    }
  }

  return { nodes, edges };
}
