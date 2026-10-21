import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { resolveRange } from "@/lib/engine/stats/range";
import { isAgentAnomalous } from "@/lib/engine/stats/anomalies";

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

  // 异常 Agent：与概览异常预警同一口径（错误率 > 30% 且样本 >= 2）
  const errorSessions = await prisma.session.findMany({
    where: { id: { in: activeSessionIds }, status: "error" },
    select: { agentId: true },
  });

  // 平均成功率
  const successRate = totalCalls > 0
    ? parseFloat(((1 - errorSessions.length / totalCalls) * 100).toFixed(1))
    : 100;

  // 性能指标：活跃 Session 的平均耗时与单次 Token 消耗
  const perfSessions = await prisma.session.findMany({
    where: { id: { in: activeSessionIds } },
    select: { totalDuration: true, totalTokens: true },
  });
  const sumDuration = perfSessions.reduce((s, x) => s + x.totalDuration, 0);
  const sumTokens = perfSessions.reduce((s, x) => s + x.totalTokens, 0);
  const avgDurationMs = totalCalls > 0 ? Math.round(sumDuration / totalCalls) : 0;
  const tokensPerCall = totalCalls > 0 ? Math.round(sumTokens / totalCalls) : 0;

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
        errors,
        successRate,
      };
    }),
  );

  // 按调用次数降序排序
  agentStats.sort((a, b) => b.calls - a.calls);

  // 异常 Agent 名单：与 /api/stats 异常预警同一判定函数
  const errorAgentList = agentStats
    .filter((a) => isAgentAnomalous({ total: a.calls, errors: a.errors }))
    .map((a) => ({
      name: a.name,
      errors: a.errors,
      total: a.calls,
      errorRate: Math.round((a.errors / a.calls) * 100),
    }));

  return NextResponse.json({
    activeAgents,
    totalCalls,
    errorAgents: errorAgentList.length,
    errorAgentList,
    successRate,
    avgDurationMs,
    tokensPerCall,
    agents: agentStats,
  });
}
