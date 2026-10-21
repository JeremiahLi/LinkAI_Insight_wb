import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRange } from "@/lib/engine/stats/range";


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

  // 找出该 Agent 的所有 Session
  const allSessions = await prisma.session.findMany({
    where: { agent: { name: decodedName } },
    select: { id: true },
  });
  const allSessionIds = allSessions.map((s) => s.id);

  // 按 Span 创建时间找出活跃 Session
  const activeSpans = await prisma.span.findMany({
    where: {
      sessionId: { in: allSessionIds },
      createdAt: { gte: startDate },
    },
    select: { sessionId: true },
  });
  const activeSessionIds = [...new Set(activeSpans.map((s) => s.sessionId))];

  // 统计
  const calls = activeSessionIds.length;
  const errorSessions = await prisma.session.count({
    where: { id: { in: activeSessionIds }, status: "error" },
  });
  const successRate = calls > 0 ? parseFloat(((1 - errorSessions / calls) * 100).toFixed(1)) : null;

  return NextResponse.json({ calls, sessions: calls, successRate });
}
