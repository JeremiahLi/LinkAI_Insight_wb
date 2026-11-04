import { prisma } from "@/lib/prisma";
import type { EvaluatorContext, ToolCall, ContextStats } from "./evaluators";


export async function assembleContext(
  sessionId: string | null,
  inputFallback: string,
  actualOutputFallback: string,
  referenceOutput: string | null
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

  let input = inputFallback;
  let actualOutput = actualOutputFallback;
  const trace: ToolCall[] = [];

  for (const span of spans) {
    if (span.kind === "user" && span.input && inputFallback === "") {
      input = span.input;
    }
    // 末条非空 answer（2026-11-04 口径修正）：旧逻辑取首条非空，
    // 多轮会话评的是中间轮次的进程性回复而非最终交付物
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

  // 会话级统计（供 threshold 等规则评估器使用）；totalDuration 为毫秒（Span.duration 之和）
  let stats: ContextStats | undefined;
  if (session) {
    stats = {
      totalTokens: session.totalTokens,
      inputTokens: session.totalInputTokens,
      outputTokens: session.totalOutputTokens,
      durationMs: session.totalDuration,
      errorCount: session.errorCount,
      toolCallCount: trace.length,
    };
  }

  return {
    input: input || inputFallback,
    actualOutput: actualOutput || actualOutputFallback,
    referenceOutput: referenceOutput || undefined,
    trace,
    stats,
  };
}
