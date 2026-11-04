import { prisma } from "@/lib/prisma";

/**
 * 从 session 的 Span 中抽取实验用例素材。
 *
 * 2026-11-04 口径修正（PLAN M0.1，实测依据：26.3% 的 answer span 输出为空，
 * 旧逻辑取「首条非空 answer」，多轮会话拿到的是中间轮次的进程性回复而非交付物，
 * 送进 judge 评的是中间态）：
 * - actualOutput 取「末条非空 answer」（会话最终交付物）；
 * - 多轮会话按轮拆分：每轮 = 该轮首条非空 user 输入 + 该轮末条非空 answer，
 *   一轮产出一条 case，用例的 input/output 保持问答配对。
 */

export interface SessionRoundCase {
  roundIndex: number;
  /** 该轮用户诉求（首条非空 user input） */
  input: string;
  /** 该轮 Agent 交付（末条非空 answer output） */
  actualOutput: string;
}

/** 按轮拆分：返回所有「有输入且有非空交付」的轮次 */
export async function extractSessionRounds(sessionId: string): Promise<SessionRoundCase[]> {
  if (!sessionId) return [];

  const spans = await prisma.span.findMany({
    where: { sessionId },
    orderBy: [{ roundIndex: "asc" }, { turnId: "asc" }],
    select: { kind: true, roundIndex: true, input: true, output: true },
  });

  // roundIndex -> { input, output }；同轮内后出现的非空值覆盖前者（取首条输入、末条输出）
  const byRound = new Map<number, { input: string; actualOutput: string }>();
  for (const span of spans) {
    const round = span.roundIndex ?? 0;
    let entry = byRound.get(round);
    if (!entry) {
      entry = { input: "", actualOutput: "" };
      byRound.set(round, entry);
    }
    if (span.kind === "user" && span.input && !entry.input) {
      entry.input = span.input;
    }
    if (span.kind === "answer" && span.output) {
      entry.actualOutput = span.output;
    }
  }

  const rounds: SessionRoundCase[] = [];
  for (const [roundIndex, entry] of [...byRound.entries()].sort((a, b) => a[0] - b[0])) {
    // 缺输入或缺交付的轮次不成 case：空 actualOutput 送评测没有意义
    if (!entry.input.trim() || !entry.actualOutput.trim()) continue;
    rounds.push({ roundIndex, input: entry.input, actualOutput: entry.actualOutput });
  }
  return rounds;
}

/**
 * 单条抽取（兼容旧调用方语义，但口径已修正）：
 * input 取末个有效轮的用户诉求（与交付物配对，兜底首条 user），
 * actualOutput 取末条非空 answer。
 */
export async function extractSessionData(
  sessionId: string
): Promise<{ input: string; actualOutput: string }> {
  const rounds = await extractSessionRounds(sessionId);
  if (rounds.length > 0) {
    const last = rounds[rounds.length - 1];
    return { input: last.input, actualOutput: last.actualOutput };
  }

  // 没有任何有效轮（如全部 answer 为空）时退回旧口径的字段级兜底，
  // 至少把「首条非空 answer」带出来，避免 case 完全空白
  if (!sessionId) return { input: "", actualOutput: "" };
  const spans = await prisma.span.findMany({
    where: { sessionId },
    orderBy: [{ roundIndex: "asc" }, { turnId: "asc" }],
    select: { kind: true, input: true, output: true },
  });
  let input = "";
  let actualOutput = "";
  for (const span of spans) {
    if (span.kind === "user" && span.input && !input) input = span.input;
    if (span.kind === "answer" && span.output) actualOutput = span.output;
  }
  return { input, actualOutput };
}
