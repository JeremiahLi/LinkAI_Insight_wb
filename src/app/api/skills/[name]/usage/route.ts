import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || "realtime";

  const now = new Date();
  const startDate = new Date();

  if (range === "realtime") {
    startDate.setHours(0, 0, 0, 0);
  } else {
    startDate.setDate(now.getDate() - 7);
    startDate.setHours(0, 0, 0, 0);
  }

  const spans = await prisma.span.findMany({
    where: {
      name: "skill",
      kind: "tool_call",
      input: { contains: decodedName },
      createdAt: { gte: startDate },
    },
    include: {
      session: {
        include: {
          user: true,
          project: true,
          agent: true,
        },
      },
    },
  });

  const userMap = new Map<string, { name: string; org: string; calls: number; lastUsed: Date }>();
  const projectMap = new Map<string, { name: string; calls: number; lastUsed: Date }>();
  const agentMap = new Map<string, { name: string; emoji: string; calls: number; lastUsed: Date }>();

  for (const span of spans) {
    const session = span.session;
    if (!session) continue;

    const user = session.user;
    if (user) {
      const existing = userMap.get(user.id);
      if (existing) {
        existing.calls++;
        if (span.createdAt > existing.lastUsed) existing.lastUsed = span.createdAt;
      } else {
        userMap.set(user.id, { name: user.name, org: user.org, calls: 1, lastUsed: span.createdAt });
      }
    }

    const project = session.project;
    if (project) {
      const existing = projectMap.get(project.id);
      if (existing) {
        existing.calls++;
        if (span.createdAt > existing.lastUsed) existing.lastUsed = span.createdAt;
      } else {
        projectMap.set(project.id, { name: project.name, calls: 1, lastUsed: span.createdAt });
      }
    }

    const agent = session.agent;
    if (agent) {
      const existing = agentMap.get(agent.id);
      if (existing) {
        existing.calls++;
        if (span.createdAt > existing.lastUsed) existing.lastUsed = span.createdAt;
      } else {
        agentMap.set(agent.id, { name: agent.name, emoji: agent.emoji, calls: 1, lastUsed: span.createdAt });
      }
    }
  }

  let users = Array.from(userMap.values())
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 3)
    .map((u) => ({ name: u.name, org: u.org, calls: u.calls, lastUsed: u.lastUsed.toISOString() }));

  let projects = Array.from(projectMap.values())
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 3)
    .map((p) => ({ name: p.name, calls: p.calls, lastUsed: p.lastUsed.toISOString() }));

  let agents = Array.from(agentMap.values())
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 3)
    .map((a) => ({ name: a.name, emoji: a.emoji, calls: a.calls, lastUsed: a.lastUsed.toISOString() }));

  return NextResponse.json({ users, projects, agents, total: spans.length });
}
