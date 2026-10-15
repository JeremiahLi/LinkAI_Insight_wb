import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { resolveRange } from "@/lib/engine/stats/range";

const prisma = new PrismaClient();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "realtime";

  // 支持 realtime / 3d / weekly / 30d / all
  const { startMs } = resolveRange(range);
  const startDate = new Date(startMs || 0);

  // 按 Span 活动时间找出活跃 Session
  const activeSpans = await prisma.span.findMany({
    where: { createdAt: { gte: startDate } },
    select: { sessionId: true },
  });
  const activeSessionIds = [...new Set(activeSpans.map((s) => s.sessionId))];

  // 活跃 Agent：活跃 Session 关联的不同 Agent 数量
  const activeSessions = await prisma.session.findMany({
    where: { id: { in: activeSessionIds } },
    select: { agentId: true },
  });
  const activeAgents = [...new Set(activeSessions.map((s) => s.agentId))].length;

  // 总调用次数：活跃 Session 总数
  const totalCalls = activeSessionIds.length;

  // 异常 Agent：有 error session 的 Agent 数量
  const errorSessions = await prisma.session.findMany({
    where: { id: { in: activeSessionIds }, status: "error" },
    select: { agentId: true },
  });
  const errorAgents = [...new Set(errorSessions.map((s) => s.agentId))].length;

  // 平均成功率
  const successRate = totalCalls > 0
    ? parseFloat(((1 - errorSessions.length / totalCalls) * 100).toFixed(1))
    : 100;

  // Top 5 Agent 调用次数（按活跃 Session 计数）
  const agentCallMap = new Map<string, number>();
  activeSessions.forEach((s) => {
    agentCallMap.set(s.agentId, (agentCallMap.get(s.agentId) || 0) + 1);
  });
  const agentCallCounts = Array.from(agentCallMap.entries())
    .map(([agentId, count]) => ({ agentId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const topAgents = await Promise.all(
    agentCallCounts.map(async (item) => {
      const agent = await prisma.agent.findUnique({
        where: { id: item.agentId },
        select: { name: true, emoji: true },
      });
      return {
        name: agent?.name ?? item.agentId,
        emoji: agent?.emoji ?? "🤖",
        calls: item.count,
      };
    }),
  );

  // 每个 Agent 的详细统计（基于活跃 Session）
  const allAgents = await prisma.agent.findMany({
    select: { id: true, name: true, emoji: true, description: true, version: true, framework: true },
    orderBy: { name: "asc" },
  });

  const agentStats = await Promise.all(
    allAgents.map(async (agent) => {
      const agentActiveSessions = await prisma.session.findMany({
        where: { agentId: agent.id, id: { in: activeSessionIds } },
        select: { status: true },
      });
      const total = agentActiveSessions.length;
      const errors = agentActiveSessions.filter((s) => s.status === "error").length;
      const successRate = total > 0 ? parseFloat(((1 - errors / total) * 100).toFixed(1)) : null;
      return {
        id: agent.id,
        name: agent.name,
        emoji: agent.emoji,
        description: agent.description,
        version: agent.version,
        framework: agent.framework,
        calls: total,
        successRate,
      };
    }),
  );

  // 按调用次数降序排序
  agentStats.sort((a, b) => b.calls - a.calls);

  return NextResponse.json({
    activeAgents,
    totalCalls,
    errorAgents,
    successRate,
    topAgents,
    agents: agentStats,
  });
}
