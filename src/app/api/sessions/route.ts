import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("id");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session id" }, { status: 400 });
  }
  try {
    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { projectId: true, userId: true, agentId: true } });
    await prisma.span.deleteMany({ where: { sessionId } });
    await prisma.session.delete({ where: { id: sessionId } });
    if (session) {
      const projectRefs = await prisma.session.count({ where: { projectId: session.projectId } });
      if (projectRefs === 0) await prisma.project.delete({ where: { id: session.projectId } }).catch(() => {});
      const userRefs = await prisma.session.count({ where: { userId: session.userId } });
      if (userRefs === 0) await prisma.user.delete({ where: { id: session.userId } }).catch(() => {});
      const agentRefs = await prisma.session.count({ where: { agentId: session.agentId } });
      if (agentRefs === 0) await prisma.agent.delete({ where: { id: session.agentId } }).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const sessions = await prisma.session.findMany({
    orderBy: { startTime: "desc" },
    include: {
      user: true,
      agent: true,
      project: true,
      _count: { select: { spans: true } },
    },
  });

  const result = sessions.map((s) => ({
    id: s.id,
    projectId: s.projectId,
    projectName: s.project.name,
    userId: s.userId,
    userName: s.user.name,
    userOrg: s.user.org,
    agentId: s.agentId,
    agentName: s.agent.name,
    agentEmoji: s.agent.emoji,
    status: s.status,
    model: s.model,
    startTime: s.startTime,
    totalRounds: s.totalRounds,
    totalSpans: s.totalSpans,
    errorCount: s.errorCount,
    totalInputTokens: s.totalInputTokens,
    totalOutputTokens: s.totalOutputTokens,
    totalCacheReadTokens: s.totalCacheReadTokens,
    totalCacheWriteTokens: s.totalCacheWriteTokens,
    totalTokens: s.totalTokens,
    totalDuration: s.totalDuration,
    forkCount: s.forkCount,
  }));

  return NextResponse.json(result);
}
