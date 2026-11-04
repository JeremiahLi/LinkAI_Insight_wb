import { prisma } from "@/lib/prisma";
import type { EvaluatorContext, ToolCall, ContextStats } from "./evaluators";

/** 装配逻辑共用的瘦 span 形状：库内 span 与快照 span 都归一到它 */
interface SpanLike {
  kind: string;
  name: string;
  input: string | null;
  output: string | null;
  error: string | null;
}

/**
 * 从 span 序列装配评测上下文（库内 span 与 M2.3 轨迹快照共用）。
 *
 * actualOutput 取「末条非空 answer」（2026-11-04 口径修正：旧逻辑取首条非空，
 * 多轮会话评的是中间轮次的进程性回复而非最终交付物）。
 */
function contextFromSpans(
  spans: SpanLike[],
  inputFallback: string,
  actualOutputFallback: string,
): { input: string; actualOutput: string; trace: ToolCall[] } {
  let input = inputFallback;
  let actualOutput = actualOutputFallback;
  const trace: ToolCall[] = [];

  for (const span of spans) {
    if (span.kind === "user" && span.input && inputFallback === "") {
      input = span.input;
    }
    // 持续覆盖 → 循环结束即末条非空
    if (span.kind === "answer" && span.output && actualOutputFallback === "") {
      actualOutput = span.output;
    }
    if (span.kind === "tool_call") {
      trace.push({
        name: span.name || "unknown",
        input: span.input || "",
        output: span.output || "",
        error: span.error || undefined,
      });
    }
  }

  return { input, actualOutput, trace };
}

/** 轨迹快照（生成回归用例时固化，见 api/issues/[id]/cases） */
interface TraceSnapshot {
  spans?: SpanLike[];
}

export async function assembleContext(
  sessionId: string | null,
  inputFallback: string,
  actualOutputFallback: string,
  referenceOutput: string | null,
  /** M2.3：原会话被清理时，回退到生成 case 时固化的轨迹快照 */
  evaluatorContextJson?: string | null,
): Promise<EvaluatorContext> {
  if (!sessionId) {
    return {
      input: inputFallback,
      actualOutput: actualOutputFallback,
      referenceOutput: referenceOutput || undefined,
      trace: [],
    };
  }

  const [spans, session] = await Promise.all([
    prisma.span.findMany({
      where: { sessionId },
      orderBy: [{ roundIndex: "asc" }, { turnId: "asc" }],
    }),
    prisma.session.findUnique({ where: { id: sessionId } }),
  ]);

  let from: { input: string; actualOutput: string; trace: ToolCall[] };
  if (spans.length > 0) {
    from = contextFromSpans(spans, inputFallback, actualOutputFallback);
  } else {
    // 原会话已删除：回退快照。快照没有也不报错——input/actualOutput 还有
    // case 自带字段兜底，只是 trace 类评估器会拿不到轨迹。
    let snapSpans: SpanLike[] = [];
    if (evaluatorContextJson) {
      try {
        const snap = JSON.parse(evaluatorContextJson) as TraceSnapshot;
        if (Array.isArray(snap?.spans) && snap.spans.length > 0) snapSpans = snap.spans;
      } catch {
        // 快照损坏按无快照处理
      }
    }
    from = contextFromSpans(snapSpans, inputFallback, actualOutputFallback);
  }

  // 会话级统计（供 threshold 等规则评估器使用）；totalDuration 为毫秒（Span.duration 之和）。
  // 会话已删除时无 stats：快照里不固化统计，缺失时 threshold 类评估器应自行容忍。
  let stats: ContextStats | undefined;
  if (session) {
    stats = {
      totalTokens: session.totalTokens,
      inputTokens: session.totalInputTokens,
      outputTokens: session.totalOutputTokens,
      durationMs: session.totalDuration,
      errorCount: session.errorCount,
      toolCallCount: from.trace.length,
    };
  }

  return {
    input: from.input || inputFallback,
    actualOutput: from.actualOutput || actualOutputFallback,
    referenceOutput: referenceOutput || undefined,
    trace: from.trace,
    stats,
  };
}
