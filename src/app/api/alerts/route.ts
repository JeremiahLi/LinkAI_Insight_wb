import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scanDegradation } from "@/lib/engine/alerts/degradation";

/** 告警中心页数据：劣化问题单 + 用户信号统计与明细 + 推送配置状态 */
export async function GET() {
  const [regressionIssues, feedbackByKind, recentFeedback, feedbackTotal] = await Promise.all([
    prisma.issue.findMany({
      where: { type: "metric_regression" },
      orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }],
      include: { agent: { select: { name: true, emoji: true } } },
    }),
    prisma.sessionFeedback.groupBy({ by: ["kind"], _count: { _all: true } }),
    prisma.sessionFeedback.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { session: { select: { id: true, title: true, agent: { select: { name: true } } } } },
    }),
    prisma.sessionFeedback.count(),
  ]);

  return NextResponse.json({
    regressions: regressionIssues.map((i) => ({
      id: i.id,
      agentName: i.agent.name,
      severity: i.severity,
      status: i.status,
      title: i.title,
      evidence: JSON.parse(i.evidenceJson || "[]"),
      occurrences: i.occurrences,
      lastSeenAt: i.lastSeenAt,
    })),
    feedbackByKind: Object.fromEntries(feedbackByKind.map((g) => [g.kind, g._count._all])),
    feedbackTotal,
    recentFeedback: recentFeedback.map((f) => ({
      id: f.id,
      sessionId: f.sessionId,
      kind: f.kind,
      note: f.note,
      by: f.by,
      createdAt: f.createdAt,
      sessionTitle: f.session.title,
      agentName: f.session.agent.name,
    })),
  });
}

/** 手动触发劣化扫描（也可由外部定时器/cron 调用） */
export async function POST() {
  try {
    const result = await scanDegradation();
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[alerts/scan] " + message);
    return NextResponse.json({ error: "Scan failed", detail: message }, { status: 500 });
  }
}
