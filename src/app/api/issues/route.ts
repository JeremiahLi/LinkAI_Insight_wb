import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * 问题单列表（PLAN M1.4）：GET /api/issues?agentName=&status=&severity=
 * 按 severity（critical > warning > info）+ occurrences 排序。
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentName = searchParams.get("agentName");
  const agentId = searchParams.get("agentId");
  const status = searchParams.get("status");
  const severity = searchParams.get("severity");

  const where: Record<string, unknown> = {};
  if (agentId) {
    where.agentId = agentId;
  } else if (agentName) {
    const agent = await prisma.agent.findUnique({ where: { name: agentName }, select: { id: true } });
    if (!agent) return NextResponse.json([]);
    where.agentId = agent.id;
  }
  if (status) where.status = { in: status.split(",").map((s) => s.trim()).filter(Boolean) };
  if (severity) where.severity = { in: severity.split(",").map((s) => s.trim()).filter(Boolean) };

  const issues = await prisma.issue.findMany({
    where,
    orderBy: [{ severity: "asc" }, { occurrences: "desc" }, { lastSeenAt: "desc" }],
    include: { agent: { select: { name: true, emoji: true } } },
  });

  return NextResponse.json(
    issues.map((i) => ({
      id: i.id,
      agentId: i.agentId,
      agentName: i.agent.name,
      agentEmoji: i.agent.emoji,
      type: i.type,
      severity: i.severity,
      fingerprint: i.fingerprint,
      title: i.title,
      evidence: JSON.parse(i.evidenceJson || "[]"),
      sessionId: i.sessionId,
      spanId: i.spanId,
      firstSeenAt: i.firstSeenAt,
      lastSeenAt: i.lastSeenAt,
      occurrences: i.occurrences,
      status: i.status,
      fixedInVersion: i.fixedInVersion,
      caseIds: JSON.parse(i.caseIdsJson || "[]") as string[],
      updatedAt: i.updatedAt,
    })),
  );
}
