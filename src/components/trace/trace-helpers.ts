import type { SessionDetail, SpanNode } from "./types";

/**
 * 将 /api/sessions/[sessionId] 返回的 Round → Turn → Span 结构
 * 拍平为 Trace Viewer 使用的扁平 Span（相对会话起点的时间线）。
 */
export interface TraceSpan {
  id: string;
  kind: string;
  name: string;
  status: string;
  model?: string;
  tokens?: NonNullable<SpanNode["tokens"]>;
  input?: string;
  output?: string;
  error?: string;
  details?: string;
  startTime: number; // epoch ms
  relStart: number; // 距会话起点的秒数（>= 0）
  durationMs: number; // 展示用时长（tool/answer 有细分时长时优先）
  timelineMs: number; // 甘特图条形实际时长
  roundIndex: number;
  branchId: string | null;
  isSkill: boolean;
}

export function isFailed(span: { status: string }): boolean {
  return span.status === "failed" || span.status === "error";
}

export function displayDurationMs(span: {
  kind: string;
  duration: number;
  llmThinkDuration?: number;
  agentReplyDuration?: number;
  toolDuration?: number;
}): number {
  if (span.kind === "tool_call" && span.toolDuration != null) return span.toolDuration;
  if ((span.kind === "llm_thinking" || span.kind === "answer") && span.agentReplyDuration != null)
    return span.agentReplyDuration;
  return span.duration;
}

export function flattenSession(detail: SessionDetail): TraceSpan[] {
  const result: Array<Omit<TraceSpan, "relStart">> = [];

  const push = (span: SpanNode, branchId: string | null) => {
    result.push({
      id: span.id,
      kind: span.kind,
      name: span.name,
      status: span.status,
      model: span.model,
      tokens: span.tokens,
      input: span.input,
      output: span.output,
      error: span.error,
      details: span.details,
      startTime: span.startTime,
      durationMs: displayDurationMs(span),
      timelineMs: span.duration,
      roundIndex: span.roundIndex,
      branchId,
      isSkill: span.kind === "tool_call" && span.name === "skill",
    });
  };

  for (const round of detail.rounds) {
    if (round.inputSpan) push(round.inputSpan, null);
    if (round.systemPromptSpan) push(round.systemPromptSpan, null);
    for (const turn of round.turns) {
      for (const span of turn.spans) push(span, null);
    }
    if (round.answerSpan) push(round.answerSpan, null);
    for (const branch of round.branches ?? []) {
      for (const span of branch.spans) push(span, branch.id);
    }
  }

  // 以最早的 Span 时刻为 0 点基准。
  // session.startTime 可能是入库时间（晚于实际会话开始），不能作为时间线原点；
  // Span 之间相对顺序由采集端保证递增，以此还原真实的穿行时间线。
  const t0 = result.length > 0 ? Math.min(...result.map((r) => r.startTime)) : 0;

  return result
    .map((r) => ({ ...r, relStart: Math.max(0, (r.startTime - t0) / 1000) }))
    .sort((a, b) => a.startTime - b.startTime);
}

/** Span 类型 → 主题色变量（深色为附件配色，浅色为工程配色） */
export function spanColor(span: { kind: string; status: string }): string {
  if (isFailed(span)) return "var(--destructive)";
  switch (span.kind) {
    case "llm_thinking":
      return "var(--trace-llm)";
    case "tool_call":
    case "tool_execution":
    case "command":
      return "var(--trace-tool)";
    case "answer":
      return "var(--trace-agent)";
    case "user":
      return "var(--trace-user)";
    case "system_prompt":
      return "var(--trace-sys)";
    default:
      return "var(--muted-foreground)";
  }
}

const kindLabelMap: Record<string, string> = {
  user: "USER",
  system_prompt: "SYSTEM",
  llm_thinking: "LLM",
  tool_call: "TOOL",
  tool_execution: "EXEC",
  command: "CMD",
  answer: "ANSWER",
  session_start: "SESSION",
  system: "SYS",
  error: "ERROR",
};

export function kindLabel(kind: string): string {
  return kindLabelMap[kind] ?? kind.toUpperCase();
}

/** 同一 Round 内：同名 LLM（模型）/ 同名 Tool 各合并为一行（无论调用多少次） */
export function rowKeyOf(span: TraceSpan): string {
  if (span.kind === "llm_thinking") return `llm:${span.model || span.name}`;
  if (span.kind === "tool_call" || span.kind === "tool_execution" || span.kind === "command")
    return `tool:${span.name}`;
  return `${span.kind}:${span.name}`;
}

export function rowLabelOf(span: TraceSpan): string {
  switch (span.kind) {
    case "llm_thinking":
      return `LLM  ${span.model || span.name}`;
    case "tool_call":
      return span.isSkill ? `Skill ${getSkillDisplayName(span)}` : `Tool ${span.name}`;
    case "command":
      return `Cmd ${span.name}`;
    case "user":
      return "用户输入";
    case "system_prompt":
      return "System Prompt";
    case "answer":
      return "最终回答";
    default:
      return span.name;
  }
}

function getSkillDisplayName(span: TraceSpan): string {
  const input = span.input;
  if (input) {
    const patterns = [/skills[\\\/]+([^\\"\\/,]+)SKILL\.md/i];
    for (const p of patterns) {
      const m = input.match(p);
      if (m && m[1]) return m[1];
    }
  }
  return span.name;
}

// ==================== Timeline 行/分组结构 ====================

export interface SpanRow {
  key: string;
  label: string;
  kind: string;
  spans: TraceSpan[];
}

export interface SpanGroup {
  id: string;
  title: string;
  isBranch: boolean;
  startSec: number;
  endSec: number;
  failed: boolean;
  rows: SpanRow[];
}

function buildRows(spans: TraceSpan[]): SpanRow[] {
  const rows: SpanRow[] = [];
  const map = new Map<string, SpanRow>();
  for (const s of spans) {
    const key = rowKeyOf(s);
    const existing = map.get(key);
    if (existing) {
      existing.spans.push(s);
    } else {
      const row: SpanRow = { key, label: rowLabelOf(s), kind: s.kind, spans: [s] };
      map.set(key, row);
      rows.push(row);
    }
  }
  return rows;
}

export function buildGroups(spans: TraceSpan[]): SpanGroup[] {
  const groups: SpanGroup[] = [];
  const roundIndices = Array.from(new Set(spans.map((s) => s.roundIndex))).sort((a, b) => a - b);

  for (const idx of roundIndices) {
    const roundSpans = spans.filter((s) => s.roundIndex === idx && !s.branchId);
    if (roundSpans.length > 0) {
      groups.push({
        id: `round-${idx}`,
        title: `Round ${idx}`,
        isBranch: false,
        startSec: Math.min(...roundSpans.map((s) => s.relStart)),
        endSec: Math.max(...roundSpans.map((s) => s.relStart + s.timelineMs / 1000)),
        failed: roundSpans.some(isFailed),
        rows: buildRows(roundSpans),
      });
    }
    // 分支（Fork）作为独立的虚线分组
    const branchIds = Array.from(
      new Set(spans.filter((s) => s.roundIndex === idx && s.branchId).map((s) => s.branchId)),
    ) as string[];
    for (const branchId of branchIds) {
      const branchSpans = spans.filter((s) => s.branchId === branchId);
      if (branchSpans.length === 0) continue;
      groups.push({
        id: `branch-${branchId}`,
        title: `Branch · ${branchSpans[0].name}`,
        isBranch: true,
        startSec: Math.min(...branchSpans.map((s) => s.relStart)),
        endSec: Math.max(...branchSpans.map((s) => s.relStart + s.timelineMs / 1000)),
        failed: branchSpans.some(isFailed),
        rows: buildRows(branchSpans),
      });
    }
  }
  return groups;
}

// ==================== Token 曲线 ====================

export interface TokenEvent {
  time: number; // 结束时刻（秒）
  start: number;
  duration: number; // 秒
  add: number; // total（含缓存）
  in: number;
  out: number;
  cache: number; // cacheRead + cacheWrite
  id: string;
  name: string;
}

export function buildTokenSeries(spans: TraceSpan[], totalSeconds: number) {
  const events: TokenEvent[] = spans
    .filter((s) => s.tokens && (s.tokens.total > 0 || s.tokens.input > 0 || s.tokens.output > 0))
    .map((s) => ({
      time: s.relStart + s.timelineMs / 1000,
      start: s.relStart,
      duration: s.timelineMs / 1000,
      add: s.tokens!.total,
      in: s.tokens!.input,
      out: s.tokens!.output,
      cache: s.tokens!.cacheRead + s.tokens!.cacheWrite,
      id: s.id,
      name: s.name,
    }))
    .sort((a, b) => a.time - b.time);

  let cum = 0;
  const points: Array<TokenEvent & { cum: number } | { time: number; cum: number }> = [
    { time: 0, cum: 0 },
  ];
  for (const e of events) {
    cum += e.add;
    points.push({ ...e, cum });
  }
  points.push({ time: totalSeconds, cum });
  return { points, events };
}

/** 会话总时长（秒）：由 Span 实际跨度决定（session.totalDuration 可能只记活跃时长/不准确） */
export function totalSecondsOf(detail: SessionDetail, spans: TraceSpan[]): number {
  void detail;
  const maxEnd = spans.reduce((m, s) => Math.max(m, s.relStart + s.timelineMs / 1000), 0);
  return Math.max(maxEnd, 0.001);
}

/**
 * 剔除轮与轮之间的无效空闲时间，避免长间隔把整体图示压扁。
 * 规则：Round 按顺序拼接；若下一轮的开始比上一轮的结束晚超过 gapSec，
 * 多出的空闲被剔除（压缩为 gapSec 的分隔）；轮内时间关系保持不变。
 */
export const ROUND_GAP_SEC = 2;

export function compressIdleGaps(spans: TraceSpan[], gapSec: number = ROUND_GAP_SEC): TraceSpan[] {
  if (spans.length === 0) return spans;
  const indices = Array.from(new Set(spans.map((s) => s.roundIndex))).sort((a, b) => a - b);

  // 每个 Round 的真实起止（基于 flattenSession 的相对秒）
  const bounds = new Map<number, { start: number; end: number }>();
  for (const idx of indices) {
    const rs = spans.filter((s) => s.roundIndex === idx);
    if (rs.length === 0) continue;
    bounds.set(idx, {
      start: Math.min(...rs.map((s) => s.relStart)),
      end: Math.max(...rs.map((s) => s.relStart + s.timelineMs / 1000)),
    });
  }

  // 逐轮累计需要前移的偏移量
  const offsets = new Map<number, number>();
  let prevEnd: number | null = null;
  let accumulated = 0;
  for (const idx of indices) {
    const b = bounds.get(idx);
    if (!b) continue;
    if (prevEnd != null) {
      const realGap = b.start - prevEnd;
      if (realGap > gapSec) accumulated += realGap - gapSec;
    }
    offsets.set(idx, accumulated);
    prevEnd = b.end;
  }

  if (accumulated <= 0) return spans;
  return spans.map((s) => ({
    ...s,
    relStart: Math.max(0, s.relStart - (offsets.get(s.roundIndex) ?? 0)),
  }));
}
