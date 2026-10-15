import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { resolveRange } from "@/lib/engine/stats/range";

const prisma = new PrismaClient();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || "realtime";

  // 支持 realtime / 3d / weekly / 30d / all
  const { startMs } = resolveRange(range);
  const startDate = new Date(startMs || 0);

  // 1. 找出该 Agent 的所有 Session
  const allSessions = await prisma.session.findMany({
    where: { agent: { name: decodedName } },
    select: { id: true },
  });
  const allSessionIds = allSessions.map((s) => s.id);

  // 2. 按 Span 创建时间找出活跃 Session
  const activeSpans = await prisma.span.findMany({
    where: {
      sessionId: { in: allSessionIds },
      createdAt: { gte: startDate },
    },
    select: { sessionId: true },
  });
  const activeSessionIds = [...new Set(activeSpans.map((s) => s.sessionId))];

  // 3. 关联查询 User 和 Project
  const sessions = await prisma.session.findMany({
    where: { id: { in: activeSessionIds } },
    include: { user: true, project: true },
  });

  const userMap = new Map<string, { name: string; org: string; calls: number; lastUsed: Date }>();
  const projectMap = new Map<string, { name: string; calls: number; lastUsed: Date }>();

  for (const session of sessions) {
    if (session.user) {
      const existing = userMap.get(session.user.id);
      if (existing) {
        existing.calls++;
        if (session.startTime > existing.lastUsed) existing.lastUsed = session.startTime;
      } else {
        userMap.set(session.user.id, { name: session.user.name, org: session.user.org, calls: 1, lastUsed: session.startTime });
      }
    }
    if (session.project) {
      const existing = projectMap.get(session.project.id);
      if (existing) {
        existing.calls++;
        if (session.startTime > existing.lastUsed) existing.lastUsed = session.startTime;
      } else {
        projectMap.set(session.project.id, { name: session.project.name, calls: 1, lastUsed: session.startTime });
      }
    }
  }

  const users = Array.from(userMap.values())
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 3)
    .map((u) => ({ name: u.name, org: u.org, calls: u.calls, lastUsed: u.lastUsed.toISOString() }));

  const projects = Array.from(projectMap.values())
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 3)
    .map((p) => ({ name: p.name, calls: p.calls, lastUsed: p.lastUsed.toISOString() }));

  // TOP 3 最近活跃的 Session
  const topSessions = await prisma.session.findMany({
    where: { id: { in: activeSessionIds } },
    select: { id: true, startTime: true },
    orderBy: { startTime: "desc" },
    take: 3,
  });

  return NextResponse.json({
    users,
    projects,
    sessions: topSessions.map((s) => ({ id: s.id, startTime: s.startTime.toISOString() })),
    total: activeSessionIds.length,
  });
}
