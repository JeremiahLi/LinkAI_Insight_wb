/**
 * 失败因果链：把孤立的失败 span 还原成「失败 → 重试 → 结局」的链。
 *
 * 为什么需要这一层（实测依据）：
 * 349 条工具错误分布在 69 个会话，其中 bash 失败后同轮重试并成功的情况大量存在。
 * 只看单条 span 会把「一次自愈的重试」和「导致任务终止的失败」并列成同级问题，
 * 直接后果是告警噪音 —— 用户看到满屏红色，最后不再看。severity 必须由结局决定，
 * 而不是由「有没有报错」决定。
 *
 * 判定不依赖 parentId：实测旧数据的 parentId 缺失率高，且同轮内时间顺序已足够
 * 区分重试与放弃。纯函数，输入瘦 span 数组，可单测。
 */

import { signatureOf, normalizeToolName, type ErrorSignature } from "./error-signature";

export type ChainOutcome =
  /** 同类失败后重试成功：属于自愈，不应告警 */
  | "retried_recovered"
  /** 连续多次同类失败仍不成功：确定性障碍 */
  | "retried_failed"
  /** 失败后未再尝试，直接交付（可能是合理的降级，也可能是掩盖问题） */
  | "abandoned"
  /** 失败后会话终止：交付失败 */
  | "fatal"
  /** 单次失败且同轮无后续相关动作 */
  | "isolated";

export type ChainSeverity = "critical" | "warning" | "info";

export interface ChainSpanInput {
  id: string;
  roundIndex: number;
  kind: string;
  name: string;
  status: string;
  error?: string | null;
  output?: string | null;
}

export interface FailureChain {
  roundIndex: number;
  /** 链上第一个失败 span */
  firstSpanId: string;
  spanIds: string[];
  /** 归一后的工具名 */
  tool: string;
  /** 首个失败的签名，代表整条链的失败类型 */
  signature: ErrorSignature;
  attempts: number;
  outcome: ChainOutcome;
  severity: ChainSeverity;
  /** 结局的人话描述，直接用于 UI 与诊断输入 */
  followedBy: string;
}

/** 向后扫描窗口：同轮内最多看 12 个 span 判定结局 */
export const CHAIN_LOOKAHEAD = 12;

/** 连续失败达到该次数即判为确定性障碍 */
export const RETRY_FAIL_THRESHOLD = 3;

const TOOL_KINDS = new Set(["tool_call", "command"]);

function isToolKind(kind: string): boolean {
  return TOOL_KINDS.has(kind);
}

/**
 * 失败判定：status 非 success 且 error 有实质内容。
 * 不采用「error 非空即失败」—— 实测 1 条 status=success 的 span 也带 error，
 * 5 条 error 实为日志（signature.kind === "not_an_error"）。
 */
function isFailure(span: ChainSpanInput): boolean {
  if (!isToolKind(span.kind)) return false;
  if (!span.error || !span.error.trim()) return false;
  return span.status !== "success";
}

function outcomeSeverity(outcome: ChainOutcome, attempts: number, kind: string): ChainSeverity {
  // 用户主动中止不是故障：哪怕链的结局是 fatal，也不该进告警队列
  if (kind === "interrupted" || kind === "not_an_error") return "info";
  switch (outcome) {
    case "fatal":
      return "critical";
    case "retried_failed":
      return "critical";
    case "abandoned":
      return attempts > 1 ? "warning" : "info";
    case "isolated":
      return "warning";
    case "retried_recovered":
      return "info";
  }
  // 理论上不可达；保留兜底避免新增 outcome 时静默通过
  return "warning";
}

function describeOutcome(outcome: ChainOutcome, tool: string, attempts: number): string {
  switch (outcome) {
    case "retried_recovered":
      return `${tool} 失败 ${attempts} 次后重试成功（自愈）`;
    case "retried_failed":
      return `${tool} 连续失败 ${attempts} 次，未见成功`;
    case "abandoned":
      return `${tool} 失败 ${attempts} 次后未再尝试，直接交付`;
    case "fatal":
      return `${tool} 失败 ${attempts} 次后会话终止`;
    case "isolated":
      return `${tool} 单次失败，同轮无后续动作`;
  }
}

/**
 * 从单个会话的 span 序列中提取失败链。
 *
 * @param spans 必须已按 (roundIndex, turnId) 升序排列
 */
export function extractFailureChains(spans: ChainSpanInput[]): FailureChain[] {
  const chains: FailureChain[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < spans.length; i++) {
    if (consumed.has(i)) continue;
    const span = spans[i];
    if (!isFailure(span)) continue;

    const sig = signatureOf({ error: span.error, name: span.name, status: span.status });
    // 日志误写：不计入失败链，但保留给数据质量统计
    if (sig.kind === "not_an_error") continue;

    const tool = normalizeToolName(span.name);
    const round = span.roundIndex;
    const spanIds = [span.id];
    consumed.add(i);
    let attempts = 1;

    let outcome: ChainOutcome = "isolated";
    const limit = Math.min(spans.length, i + 1 + CHAIN_LOOKAHEAD);

    for (let j = i + 1; j < limit; j++) {
      const next = spans[j];
      // 跨轮即结束：新一轮用户诉求下的重试与上一轮不是同一件事
      if (next.roundIndex !== round) break;

      if (next.kind === "answer") {
        const delivered = next.status === "success" && !!(next.output && next.output.trim());
        outcome = delivered ? "abandoned" : "fatal";
        break;
      }

      if (!isToolKind(next.kind)) continue;

      const nextTool = normalizeToolName(next.name);
      if (nextTool !== tool) continue;

      const nextFailed = isFailure(next);
      if (nextFailed) {
        const nextSig = signatureOf({ error: next.error, name: next.name, status: next.status });
        if (nextSig.kind === "not_an_error") continue;
        // 同一工具再次失败即视为重试（签名可能因上下文微变而不同，仍算同一条链）
        attempts += 1;
        spanIds.push(next.id);
        consumed.add(j);
        if (attempts >= RETRY_FAIL_THRESHOLD) {
          outcome = "retried_failed";
        }
        continue;
      }

      // 同工具、非失败 → 重试成功
      outcome = "retried_recovered";
      break;
    }

    chains.push({
      roundIndex: round,
      firstSpanId: span.id,
      spanIds,
      tool,
      signature: sig,
      attempts,
      outcome,
      severity: outcomeSeverity(outcome, attempts, sig.kind),
      followedBy: describeOutcome(outcome, tool, attempts),
    });
  }

  return chains;
}

/** 聚合统计：供看板与诊断入口使用 */
export interface ChainSummary {
  total: number;
  byOutcome: Record<ChainOutcome, number>;
  byKind: Record<string, number>;
  byFamily: { family: string; count: number; sessions: number; sampleSummary: string }[];
  /** 需要人处理的数量（critical + warning） */
  actionable: number;
}

export function summarizeChains(
  chains: (FailureChain & { sessionId?: string })[],
): ChainSummary {
  const byOutcome: Record<ChainOutcome, number> = {
    retried_recovered: 0,
    retried_failed: 0,
    abandoned: 0,
    fatal: 0,
    isolated: 0,
  };
  const byKind: Record<string, number> = {};
  const famMap = new Map<string, { count: number; sessions: Set<string>; sample: string }>();

  for (const c of chains) {
    byOutcome[c.outcome] += 1;
    byKind[c.signature.kind] = (byKind[c.signature.kind] ?? 0) + 1;
    const cur = famMap.get(c.signature.family) ?? { count: 0, sessions: new Set<string>(), sample: c.signature.summary };
    cur.count += 1;
    if (c.sessionId) cur.sessions.add(c.sessionId);
    famMap.set(c.signature.family, cur);
  }

  const byFamily = [...famMap.entries()]
    .map(([family, v]) => ({ family, count: v.count, sessions: v.sessions.size, sampleSummary: v.sample }))
    .sort((a, b) => b.count - a.count);

  return {
    total: chains.length,
    byOutcome,
    byKind,
    byFamily,
    actionable: chains.filter((c) => c.severity !== "info").length,
  };
}
