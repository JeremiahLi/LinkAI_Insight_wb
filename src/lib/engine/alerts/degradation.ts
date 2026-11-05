import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { SQL_BAD, SQL_FINISHED, SQL_PARTIAL } from "@/lib/engine/stats/session-outcome";

/**
 * 发布后劣化检测（PLAN M4.1）+ 单通道推送（M4.2）。
 *
 * 与 PLAN 原文的偏差：原文是「新 Release 后 24h」，但 Release 表是 M3 的产物且
 * agentVersion 才刚开始积累。这里先做**无 Release 依赖的滑动窗口对比**：
 * 最近 24h vs 之前 7 天基线，按 Agent 粒度算三项指标（成功率 / 单会话 token /
 * P95 耗时），劣化即 upsert Issue（type=metric_regression）并推送。
 * Release 数据齐了以后，M3.1 的 upsert 可以在发布事件上触发同一个函数。
 *
 * 阈值写死（PLAN 设计原则：先验证有用再抽象，不做可配置规则引擎）。
 */

const RECENT_MS = 24 * 60 * 60 * 1000;
const BASELINE_MS = 7 * 24 * 60 * 60 * 1000;
/** 基线最少样本数：低于此数不做对比（没有基线就没有「劣化」可言） */
const MIN_BASELINE = 5;
const MIN_RECENT = 3;

const ISSUE_TYPE = "metric_regression";

export interface DegradationFinding {
  agentId: string;
  agentName: string;
  metric: "success_rate" | "tokens_per_session" | "p95_duration";
  severity: "critical" | "warning";
  title: string;
  recent: number;
  baseline: number;
  /** 成功率是百分点（pp），其余是倍数变化 */
  delta: string;
  recentSamples: number;
  baselineSamples: number;
}

interface WindowStats {
  sessions: number;
  finished: number;
  bad: number;
  partial: number;
  avgTokens: number;
  p95Duration: number;
}

async function windowStats(where: Prisma.Sql): Promise<WindowStats> {
  const rows = await prisma.$queryRaw<
    Array<{
      sessions: bigint;
      finished: bigint;
      bad: bigint;
      partial: bigint;
      avg_tokens: number | null;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(*) AS sessions,
      SUM(CASE WHEN ${SQL_FINISHED} THEN 1 ELSE 0 END) AS finished,
      SUM(CASE WHEN ${SQL_BAD} THEN 1 ELSE 0 END) AS bad,
      SUM(CASE WHEN ${SQL_PARTIAL} THEN 1 ELSE 0 END) AS partial,
      AVG(CASE WHEN ${SQL_FINISHED} THEN s.totalTokens END) AS avg_tokens
    FROM session s WHERE ${where}
  `);
  // P95 由调用方用 p95Duration() 独立补算（SQLite 无 PERCENTILE，用有序行偏移近似）
  return {
    sessions: Number(rows[0]?.sessions ?? 0),
    finished: Number(rows[0]?.finished ?? 0),
    bad: Number(rows[0]?.bad ?? 0),
    partial: Number(rows[0]?.partial ?? 0),
    avgTokens: Number(rows[0]?.avg_tokens ?? 0),
    p95Duration: 0,
  };
}

async function p95Duration(where: Prisma.Sql): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ totalDuration: number }>>(Prisma.sql`
    SELECT s.totalDuration FROM session s WHERE ${where} ORDER BY s.totalDuration ASC
  `);
  if (rows.length === 0) return 0;
  const idx = Math.min(rows.length - 1, Math.floor(rows.length * 0.95));
  return Number(rows[idx]?.totalDuration ?? 0);
}

export function getAlertWebhookUrl(): string {
  return process.env.ALERT_WEBHOOK_URL || "";
}

async function webhookUrlFromSettings(): Promise<string> {
  const settings = await prisma.userSettings.findUnique({ where: { user: "default" } });
  if (!settings) return "";
  try {
    const parsed = JSON.parse(settings.settingsJson) as { alertWebhookUrl?: string };
    return parsed.alertWebhookUrl || "";
  } catch {
    return "";
  }
}

/** 企业微信机器人 markdown 格式；其他 webhook 自行适配 */
async function notifyWebhook(url: string, content: string): Promise<{ ok: boolean; detail: string }> {
  if (!url) return { ok: false, detail: "webhook 未配置" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "markdown", markdown: { content } }),
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.ok, detail: res.ok ? "sent" : `HTTP ${res.status}` };
  } catch (e: unknown) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

function rateOf(w: { finished: number; bad: number; partial: number }): number | null {
  if (w.finished === 0) return null;
  return (1 - (w.bad + w.partial * 0.5) / w.finished) * 100;
}

export interface ScanResult {
  checkedAgents: number;
  findings: DegradationFinding[];
  created: number;
  updated: number;
  notified: boolean;
  webhookConfigured: boolean;
  notifyDetail: string;
  notes: string[];
}

export async function scanDegradation(): Promise<ScanResult> {
  const now = Date.now();
  const recentStart = new Date(now - RECENT_MS);
  const baselineStart = new Date(now - RECENT_MS - BASELINE_MS);
  const baselineEnd = recentStart;
  const notes: string[] = [];

  // 有近期活动的 Agent 才值得查（无近期会话无劣化可言）
  const agents = await prisma.agent.findMany({
    where: { sessions: { some: { startTime: { gte: recentStart } } } },
    select: { id: true, name: true },
  });

  const findings: DegradationFinding[] = [];
  let created = 0;
  let updated = 0;

  for (const agent of agents) {
    const scope = Prisma.sql`s.agentId = ${agent.id} AND s.status <> 'active'`;
    const recent = await windowStats(Prisma.sql`${scope} AND s.startTime >= ${recentStart}`);
    recent.p95Duration = await p95Duration(Prisma.sql`${scope} AND s.startTime >= ${recentStart}`);
    const baseline = await windowStats(
      Prisma.sql`${scope} AND s.startTime >= ${baselineStart} AND s.startTime < ${baselineEnd}`,
    );
    baseline.p95Duration = await p95Duration(
      Prisma.sql`${scope} AND s.startTime >= ${baselineStart} AND s.startTime < ${baselineEnd}`,
    );

    if (baseline.finished < MIN_BASELINE || recent.finished < MIN_RECENT) {
      notes.push(
        `${agent.name}：基线 ${baseline.finished} / 近期 ${recent.finished} 个完成会话，样本不足跳过`,
      );
      continue;
    }

    // 指标 1：成功率（百分点，跌 ≥5pp 为 critical）
    const recentRate = rateOf(recent);
    const baselineRate = rateOf(baseline);
    if (recentRate != null && baselineRate != null && baselineRate - recentRate >= 5) {
      findings.push({
        agentId: agent.id,
        agentName: agent.name,
        metric: "success_rate",
        severity: "critical",
        title: `成功率劣化 ${baselineRate.toFixed(1)}% → ${recentRate.toFixed(1)}%（24h vs 前7天）`,
        recent: Number(recentRate.toFixed(1)),
        baseline: Number(baselineRate.toFixed(1)),
        delta: `${(recentRate - baselineRate).toFixed(1)}pp`,
        recentSamples: recent.finished,
        baselineSamples: baseline.finished,
      });
    }

    // 指标 2：单会话 token（+30% 为 warning）
    if (baseline.avgTokens > 0 && recent.avgTokens > baseline.avgTokens * 1.3) {
      findings.push({
        agentId: agent.id,
        agentName: agent.name,
        metric: "tokens_per_session",
        severity: "warning",
        title: `单会话 token 上涨 ${(((recent.avgTokens - baseline.avgTokens) / baseline.avgTokens) * 100).toFixed(0)}%`,
        recent: Math.round(recent.avgTokens),
        baseline: Math.round(baseline.avgTokens),
        delta: `+${(((recent.avgTokens - baseline.avgTokens) / baseline.avgTokens) * 100).toFixed(0)}%`,
        recentSamples: recent.finished,
        baselineSamples: baseline.finished,
      });
    }

    // 指标 3：P95 单会话耗时（+30% 为 warning）
    if (baseline.p95Duration > 0 && recent.p95Duration > baseline.p95Duration * 1.3) {
      findings.push({
        agentId: agent.id,
        agentName: agent.name,
        metric: "p95_duration",
        severity: "warning",
        title: `P95 耗时上涨 ${(((recent.p95Duration - baseline.p95Duration) / baseline.p95Duration) * 100).toFixed(0)}%`,
        recent: Math.round(recent.p95Duration),
        baseline: Math.round(baseline.p95Duration),
        delta: `+${(((recent.p95Duration - baseline.p95Duration) / baseline.p95Duration) * 100).toFixed(0)}%`,
        recentSamples: recent.finished,
        baselineSamples: baseline.finished,
      });
    }
  }

  // upsert 到 Issue（agentId + fingerprint 幂等；与 issues/recompute.ts 同一套生命周期）
  for (const f of findings) {
    const fingerprint = `${ISSUE_TYPE}:${f.metric}`;
    const existing = await prisma.issue.findUnique({
      where: { agentId_fingerprint: { agentId: f.agentId, fingerprint } },
    });
    const evidence = [
      {
        metric: f.metric,
        baseline: f.baseline,
        recent: f.recent,
        delta: f.delta,
        recentSamples: f.recentSamples,
        baselineSamples: f.baselineSamples,
        window: "24h vs 前7天",
      },
    ];
    if (!existing) {
      await prisma.issue.create({
        data: {
          agentId: f.agentId,
          type: ISSUE_TYPE,
          severity: f.severity,
          fingerprint,
          title: f.title,
          evidenceJson: JSON.stringify(evidence),
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          occurrences: 1,
          status: "open",
        },
      });
      created++;
    } else {
      await prisma.issue.update({
        where: { id: existing.id },
        data: {
          title: f.title,
          severity: f.severity,
          evidenceJson: JSON.stringify(evidence),
          lastSeenAt: new Date(),
          occurrences: existing.occurrences + 1,
          // 上次已恢复（stale）的再次劣化 → 重开
          ...(existing.status === "stale" ? { status: "open" } : {}),
        },
      });
      updated++;
    }
  }

  // 已恢复的劣化：上次 open 的指标指纹本轮没再出现 → stale（指标恢复不是修复，是消失）
  const openMetricIssues = await prisma.issue.findMany({
    where: { type: ISSUE_TYPE, status: "open" },
    select: { id: true, fingerprint: true, agentId: true },
  });
  const activeFps = new Set(findings.map((f) => `${ISSUE_TYPE}:${f.metric}`));
  for (const issue of openMetricIssues) {
    // 只处理本次扫描覆盖到的 Agent（其他 Agent 没扫描，不能下结论）
    if (!agents.some((a) => a.id === issue.agentId)) continue;
    if (activeFps.has(issue.fingerprint)) continue;
    await prisma.issue.update({ where: { id: issue.id }, data: { status: "stale" } });
    notes.push(`指标已恢复 → stale：${issue.fingerprint}`);
  }

  // 推送（M4.2 单通道：企业微信机器人 webhook；settings 优先，env 兜底）
  let notifyDetail = "无劣化，未推送";
  let notified = false;
  const webhookConfigured = Boolean((await webhookUrlFromSettings()) || getAlertWebhookUrl());
  if (findings.length > 0) {
    const url = (await webhookUrlFromSettings()) || getAlertWebhookUrl();
    if (!url) {
      notifyDetail = "webhook 未配置（settingsJson.alertWebhookUrl 或 env ALERT_WEBHOOK_URL），劣化已落库未推送";
    } else {
      const lines = findings.map(
        (f) => `> **${f.agentName}** ${f.title}（近期 n=${f.recentSamples} / 基线 n=${f.baselineSamples}）`,
      );
      const base = process.env.ALERT_BASE_URL || "http://localhost:3010";
      const content = `**Agent 指标劣化告警**\n${lines.join("\n")}\n> [查看告警中心](${base}/alerts)`;
      const r = await notifyWebhook(url, content);
      notified = r.ok;
      notifyDetail = r.ok ? "webhook 推送成功" : `webhook 推送失败：${r.detail}`;
    }
  }

  return {
    checkedAgents: agents.length,
    findings,
    created,
    updated,
    notified,
    webhookConfigured,
    notifyDetail,
    notes,
  };
}
