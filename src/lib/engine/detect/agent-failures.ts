/**
 * Agent 级失败分析：把纯函数检测器接到数据库上，产出前端可直接渲染的报告。
 *
 * 与 stats/agent-detail.ts 的 issues 分工（两者并存，不互相替代）：
 * - agent-detail 的 issues 是**统计聚合级**（工具失败率、错误聚类、慢 span、衰退），
 *   回答「哪个工具在失败、失败率多高」。
 * - 本模块是**过程链路级**（失败 → 重试 → 结局），回答「这一次失败是怎么发生、
 *   最后有没有自愈、根因是什么、该怎么修」。
 * 前者只能给出比率，后者能把 349 条原始错误收敛成 23 条待处理项 —— 因为
 * 实测 84% 的工具失败是重试后自愈的，按比率看会把它们全算成问题。
 */

import { prisma } from "@/lib/prisma";
import { extractFailureChains, type ChainOutcome, type ChainSpanInput, type FailureChain } from "./failure-chain";
import { signatureOf, type ErrorSignatureKind } from "./error-signature";
import { suggestRemediation, isActionable, type Remediation } from "./remediation";
import { buildCommandStats, type CommandStat } from "./command-stats";

export type FailureSeverity = "critical" | "warning" | "info";

export interface FailureChainDTO {
  sessionId: string;
  spanId: string;
  family: string;
  kind: ErrorSignatureKind;
  severity: FailureSeverity;
  outcome: ChainOutcome;
  tool: string;
  roundIndex: number;
  attempts: number;
  summary: string;
  garbled: boolean;
  followedBy: string;
  /** 会话开始时间（ISO），用于排序与展示 */
  startedAt: string;
  rootCause: string;
  actions: string[];
  confidence: Remediation["confidence"];
}

export interface FailureFamilyDTO {
  family: string;
  kind: ErrorSignatureKind;
  count: number;
  sessions: number;
  severity: FailureSeverity;
  sampleSummary: string;
  garbled: boolean;
  rootCause: string;
  actions: string[];
  confidence: Remediation["confidence"];
}

export interface AgentFailureReport {
  agentName: string;
  windowDays: number;
  sessions: number;
  sessionsWithFailures: number;
  totals: {
    chains: number;
    actionable: number;
    selfHealed: number;
  };
  byOutcome: Record<ChainOutcome, number>;
  byKind: { kind: ErrorSignatureKind; count: number }[];
  families: FailureFamilyDTO[];
  /** 仅含待处理链（已排除重试自愈、用户中止、日志误写） */
  chains: FailureChainDTO[];
  /**
   * 命令级聚合：哪个具体命令失败多少次、失败与成功时的参数差在哪。
   * 对应「bash 失败 12 次」无法行动的问题 —— bash 是容器，命令才是单位。
   */
  commands: CommandStat[];
  dataNotes: string[];
}

const SEVERITY_WEIGHT: Record<FailureSeverity, number> = { critical: 0, warning: 1, info: 2 };

const EMPTY_OUTCOMES: Record<ChainOutcome, number> = {
  retried_recovered: 0,
  retried_failed: 0,
  abandoned: 0,
  fatal: 0,
  isolated: 0,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getAgentFailureReport(
  agentName: string,
  opts: { startMs: number },
): Promise<AgentFailureReport | null> {
  const agent = await prisma.agent.findUnique({
    where: { name: agentName },
    select: { id: true, name: true },
  });
  if (!agent) return null;

  const sessionWhere = {
    agentId: agent.id,
    ...(opts.startMs > 0 ? { startTime: { gte: new Date(opts.startMs) } } : {}),
  };

  const sessions = await prisma.session.findMany({
    where: sessionWhere,
    select: { id: true, startTime: true },
  });

  const sessionStart = new Map(sessions.map((s) => [s.id, s.startTime]));
  const windowDays = opts.startMs > 0 ? Math.max(1, Math.ceil((Date.now() - opts.startMs) / DAY_MS)) : 0;

  if (sessions.length === 0) {
    return {
      agentName: agent.name,
      windowDays,
      sessions: 0,
      sessionsWithFailures: 0,
      totals: { chains: 0, actionable: 0, selfHealed: 0 },
      byOutcome: { ...EMPTY_OUTCOMES },
      byKind: [],
      families: [],
      chains: [],
      commands: [],
      dataNotes: ["该时间段内没有会话记录"],
    };
  }

  // answer 也要取：判定链的结局（是否交付）依赖它
  const spans = await prisma.span.findMany({
    where: {
      sessionId: { in: sessions.map((s) => s.id) },
      kind: { in: ["tool_call", "command", "answer"] },
    },
    orderBy: [{ sessionId: "asc" }, { roundIndex: "asc" }, { turnId: "asc" }],
    select: {
      id: true,
      sessionId: true,
      roundIndex: true,
      kind: true,
      name: true,
      status: true,
      error: true,
      output: true,
      input: true,
      duration: true,
    },
  });

  const bySession = new Map<string, ChainSpanInput[]>();
  for (const sp of spans) {
    const arr = bySession.get(sp.sessionId);
    if (arr) arr.push(sp);
    else bySession.set(sp.sessionId, [sp]);
  }

  const rawChains: {
    sessionId: string;
    chain: FailureChain;
  }[] = [];
  for (const [sessionId, list] of bySession) {
    for (const chain of extractFailureChains(list)) {
      rawChains.push({ sessionId, chain });
    }
  }

  const byOutcome: Record<ChainOutcome, number> = { ...EMPTY_OUTCOMES };
  const kindCount = new Map<ErrorSignatureKind, number>();
  for (const { chain } of rawChains) {
    byOutcome[chain.outcome] += 1;
    kindCount.set(chain.signature.kind, (kindCount.get(chain.signature.kind) ?? 0) + 1);
  }

  const actionable = rawChains.filter(({ chain }) =>
    isActionable(chain.signature, chain.outcome, chain.severity),
  );

  const chains: FailureChainDTO[] = actionable
    .map(({ sessionId, chain }) => {
      const rem = suggestRemediation(chain.signature);
      return {
        sessionId,
        spanId: chain.firstSpanId,
        family: chain.signature.family,
        kind: chain.signature.kind,
        severity: chain.severity,
        outcome: chain.outcome,
        tool: chain.tool,
        roundIndex: chain.roundIndex,
        attempts: chain.attempts,
        summary: chain.signature.summary,
        garbled: chain.signature.garbled,
        followedBy: chain.followedBy,
        startedAt: (sessionStart.get(sessionId) ?? new Date()).toISOString(),
        rootCause: rem.rootCause,
        actions: rem.actions,
        confidence: rem.confidence,
      };
    })
    .sort(
      (a, b) =>
        SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity] ||
        b.attempts - a.attempts ||
        (a.startedAt < b.startedAt ? 1 : -1),
    );

  /* ---- 按 family 聚合排行 ---- */
  const famMap = new Map<string, FailureFamilyDTO & { sessionSet: Set<string> }>();
  for (const c of chains) {
    const cur = famMap.get(c.family);
    if (cur) {
      cur.count += 1;
      cur.sessionSet.add(c.sessionId);
      if (SEVERITY_WEIGHT[c.severity] < SEVERITY_WEIGHT[cur.severity]) cur.severity = c.severity;
    } else {
      famMap.set(c.family, {
        family: c.family,
        kind: c.kind,
        count: 1,
        sessions: 0,
        severity: c.severity,
        sampleSummary: c.summary,
        garbled: c.garbled,
        rootCause: c.rootCause,
        actions: c.actions,
        confidence: c.confidence,
        sessionSet: new Set([c.sessionId]),
      });
    }
  }
  const families: FailureFamilyDTO[] = [...famMap.values()]
    .map(({ sessionSet, ...f }) => ({ ...f, sessions: sessionSet.size }))
    .sort((a, b) => SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity] || b.count - a.count);

  /* ---- 数据质量提示 ---- */
  const dataNotes: string[] = [];
  const garbledCount = rawChains.filter((c) => c.chain.signature.garbled).length;
  if (garbledCount > 0) {
    dataNotes.push(
      `${garbledCount} 条错误的原文含乱码（采集端 GBK/UTF-8 混用），摘要可能不可读，但分类不受影响`,
    );
  }

  // 日志误写：status 失败但文本其实是正常输出，不计入问题
  let notAnError = 0;
  for (const sp of spans) {
    if (sp.kind !== "tool_call" && sp.kind !== "command") continue;
    if (sp.status === "success") continue;
    if (!sp.error || !sp.error.trim()) continue;
    if (signatureOf({ error: sp.error, name: sp.name, status: sp.status }).kind === "not_an_error") {
      notAnError += 1;
    }
  }
  if (notAnError > 0) {
    dataNotes.push(`${notAnError} 条"失败" span 的 error 实为命令正常输出（采集端误写），已排除`);
  }

  const codeOnly = chains.filter((c) => c.kind === "exit_code").length;
  if (codeOnly > 0) {
    dataNotes.push(`${codeOnly} 条仅有退出码，脚本未输出结构化错误，无法进一步归因`);
  }

  if (byOutcome.retried_recovered > 0) {
    dataNotes.push(
      `${byOutcome.retried_recovered} 条失败在重试后自愈，未计入待处理（按错误数排名的做法会把它们误报成该 Agent 的问题）`,
    );
  }

  return {
    agentName: agent.name,
    windowDays,
    sessions: sessions.length,
    sessionsWithFailures: new Set(rawChains.map((c) => c.sessionId)).size,
    totals: {
      chains: rawChains.length,
      actionable: chains.length,
      selfHealed: byOutcome.retried_recovered,
    },
    byOutcome,
    byKind: [...kindCount.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
    families,
    chains,
    commands: buildCommandStats(spans, 20),
    dataNotes,
  };
}
