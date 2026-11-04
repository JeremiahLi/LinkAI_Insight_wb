import { prisma } from "@/lib/prisma";
import { getAgentFailureReport } from "../detect/agent-failures";

/**
 * Issue 重算：把 detect 层的检测结论 upsert 成可追踪的问题单实体（PLAN M1.4）。
 *
 * 指纹（fingerprint）= `tool_failure_chain:<family>:<tool>`：同一失败家族在同一
 * 工具上的失败，无论发生在哪个会话、哪个版本，都是同一个问题。family 由
 * error-signature 归一（如 python:ValidationError），已经过跨会话聚类验证。
 *
 * 幂等性（与 PLAN 原文的偏差，有意为之）：PLAN 写「累加 occurrences」，
 * 但重复重算同一窗口会双计。这里改为 occurrences = 窗口内实测计数，
 * lastSeenAt / firstSeenAt 取并集极值 —— 同一窗口重跑结果完全一致，
 * 满足验收标准「同一 fingerprint 在两次重跑中稳定命中同一批会话」。
 *
 * 状态机（与分叉仓库的差异，有意为之）：只保留 open / ack / fixed / wontfix / stale
 * 五态，不做 candidate 中间态。fixed 的指纹再次出现 → 重开为 open（复发）；
 * wontfix 是人的决定，机器不推翻。
 */

export const ISSUE_TYPE_CHAIN = "tool_failure_chain";

const SEVERITY_WEIGHT: Record<string, number> = { critical: 0, warning: 1, info: 2 };

export interface RecomputeResult {
  agentId: string;
  agentName: string;
  windowDays: number;
  detected: number;
  created: number;
  updated: number;
  /** fixed → open（复发） */
  reopened: number;
  /** 窗口内不再出现且状态为 open 的既有问题单（标记 stale） */
  staled: number;
}

export async function recomputeIssuesForAgent(
  agentName: string,
  rangeDays: number,
): Promise<RecomputeResult | null> {
  const agent = await prisma.agent.findUnique({
    where: { name: agentName },
    select: { id: true, name: true },
  });
  if (!agent) return null;

  const startMs = rangeDays > 0 ? Date.now() - rangeDays * 24 * 60 * 60 * 1000 : 0;
  const report = await getAgentFailureReport(agentName, { startMs });
  if (!report) return null;

  // 按指纹分组窗口内的失败链
  type ChainDTO = (typeof report.chains)[number];
  type Group = {
    family: string;
    tool: string;
    chains: ChainDTO[];
  };

  const groups = new Map<string, Group>();
  for (const c of report.chains) {
    const fp = `${ISSUE_TYPE_CHAIN}:${c.family}:${c.tool}`;
    let g = groups.get(fp);
    if (!g) {
      g = { family: c.family, tool: c.tool, chains: [] };
      groups.set(fp, g);
    }
    g.chains.push(c);
  }

  const result: RecomputeResult = {
    agentId: agent.id,
    agentName: agent.name,
    windowDays: report.windowDays,
    detected: report.chains.length,
    created: 0,
    updated: 0,
    reopened: 0,
    staled: 0,
  };

  const now = new Date();
  const seenFingerprints = new Set<string>();

  for (const [fingerprint, g] of groups) {
    seenFingerprints.add(fingerprint);
    const chains = [...g.chains].sort(
      (a, b) =>
        SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity] ||
        b.attempts - a.attempts ||
        (a.startedAt < b.startedAt ? 1 : -1),
    );
    const top = chains[0];
    const severity = chains.reduce(
      (min, c) => (SEVERITY_WEIGHT[c.severity] < SEVERITY_WEIGHT[min] ? c.severity : min),
      "info" as (typeof top)["severity"],
    );
    const evidence = chains.slice(0, 10).map((c) => ({
      sessionId: c.sessionId,
      spanId: c.spanId,
      summary: c.summary,
      outcome: c.outcome,
      attempts: c.attempts,
      startedAt: c.startedAt,
    }));
    const times = chains.map((c) => new Date(c.startedAt).getTime()).filter(Number.isFinite);
    const lastSeenAt = times.length ? new Date(Math.max(...times)) : now;
    const firstSeenAt = times.length ? new Date(Math.min(...times)) : now;
    // 25.8% 的错误原文含 GBK/UTF-8 乱码：标题显式标注，不让用户对着乱码猜
    const title = `${top.tool} · ${top.garbled ? "（原文编码损坏）" : ""}${top.summary}`.slice(0, 200);

    const existing = await prisma.issue.findUnique({
      where: { agentId_fingerprint: { agentId: agent.id, fingerprint } },
    });

    if (!existing) {
      await prisma.issue.create({
        data: {
          agentId: agent.id,
          type: ISSUE_TYPE_CHAIN,
          severity,
          fingerprint,
          title,
          evidenceJson: JSON.stringify(evidence),
          sessionId: top.sessionId,
          spanId: top.spanId,
          firstSeenAt,
          lastSeenAt,
          occurrences: chains.length,
          status: "open",
        },
      });
      result.created++;
      continue;
    }

    // 复发判定：fixed 的指纹再次命中 → 重开（wontfix 除外）
    const reopen = existing.status === "fixed" || existing.status === "stale";
    await prisma.issue.update({
      where: { id: existing.id },
      data: {
        severity,
        title,
        evidenceJson: JSON.stringify(evidence),
        // 代表样例换成本窗口最严重的一条
        sessionId: top.sessionId,
        spanId: top.spanId,
        firstSeenAt:
          existing.firstSeenAt.getTime() <= firstSeenAt.getTime() ? existing.firstSeenAt : firstSeenAt,
        lastSeenAt:
          existing.lastSeenAt.getTime() >= lastSeenAt.getTime() ? existing.lastSeenAt : lastSeenAt,
        occurrences: Math.max(existing.occurrences, chains.length),
        ...(reopen ? { status: "open" } : {}),
      },
    });
    result.updated++;
    if (reopen && existing.status === "fixed") result.reopened++;
  }

  // 窗口内不再出现的 open 问题 → stale（不是修复，是超出观察窗口）
  const openIssues = await prisma.issue.findMany({
    where: { agentId: agent.id, status: "open" },
    select: { id: true, fingerprint: true, lastSeenAt: true },
  });
  for (const issue of openIssues) {
    if (seenFingerprints.has(issue.fingerprint)) continue;
    if (startMs > 0 && issue.lastSeenAt.getTime() >= startMs) continue; // 窗口内出现过
    await prisma.issue.update({ where: { id: issue.id }, data: { status: "stale" } });
    result.staled++;
  }

  return result;
}
