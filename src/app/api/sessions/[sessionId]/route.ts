import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      user: true,
      agent: true,
      project: true,
      spans: { orderBy: [{ roundIndex: "asc" }, { turnId: "asc" }, { startTime: "asc" }] },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Build tree: Round → Turn → Spans
  const allSpans = session.spans;
  const roundIndices = Array.from(new Set(allSpans.map((s) => s.roundIndex))).sort((a, b) => a - b);

  const rounds = roundIndices.map((rIdx) => {
    const roundSpans = allSpans.filter((s) => s.roundIndex === rIdx && !s.branchId);

    // Extract round-level spans
    const inputSpan = roundSpans.find((s) => s.kind === "user" || s.kind === "input");
    const systemPromptSpan = roundSpans.find((s) => s.kind === "system_prompt");
    const answerSpan = roundSpans.find((s) => s.kind === "answer");

    // Remaining spans belong to turns
    const turnSpans = roundSpans.filter((s) =>
      s.kind !== "user" && s.kind !== "input" &&
      s.kind !== "system_prompt" && s.kind !== "answer"
    );
    const turnIds = Array.from(new Set(turnSpans.map((s) => s.turnId))).sort((a, b) => a - b);

    const turns = turnIds.map((tId) => {
      const spans = turnSpans.filter((s) => s.turnId === tId);
      return {
        id: `${sessionId}-r${rIdx}-t${tId}`,
        roundIndex: rIdx,
        turnId: tId,
        spans: spans.map(serializeSpan),
      };
    });

    const forkSpan = roundSpans.find((s) => s.isForkPoint);
    const branches = forkSpan
      ? Array.from(new Set(allSpans.filter((s) => s.roundIndex === rIdx && s.branchId).map((s) => s.branchId)))
          .map((branchId) => {
            const branchSpans = allSpans.filter((s) => s.branchId === branchId);
            return {
              id: branchId,
              roundId: `${sessionId}-r${rIdx}`,
              name: branchSpans[0]?.name || branchId,
              spans: branchSpans.map(serializeSpan),
              isActive: branchSpans.some((s) => s.status === "success"),
            };
          })
      : undefined;

    return {
      id: `${sessionId}-r${rIdx}`,
      sessionId,
      index: rIdx,
      inputSpan: inputSpan ? serializeSpan(inputSpan) : undefined,
      systemPromptSpan: systemPromptSpan ? serializeSpan(systemPromptSpan) : undefined,
      answerSpan: answerSpan ? serializeSpan(answerSpan) : undefined,
      turns,
      isForkPoint: !!forkSpan,
      branches,
    };
  });

  const result = {
    id: session.id,
    projectId: session.projectId,
    projectName: session.project.name,
    userId: session.userId,
    userName: session.user.name,
    userOrg: session.user.org,
    agentId: session.agentId,
    agentName: session.agent.name,
    agentEmoji: session.agent.emoji,
    status: session.status,
    model: session.model,
    startTime: session.startTime,
    endTime: session.endTime,
    totalRounds: session.totalRounds,
    totalSpans: session.totalSpans,
    errorCount: session.errorCount,
    totalInputTokens: session.totalInputTokens,
    totalOutputTokens: session.totalOutputTokens,
    totalCacheReadTokens: session.totalCacheReadTokens,
    totalCacheWriteTokens: session.totalCacheWriteTokens,
    totalTokens: session.totalTokens,
    totalDuration: session.totalDuration,
    forkCount: session.forkCount,
    rounds,
  };

  return NextResponse.json(result);
}

function serializeSpan(span: {
  id: string;
  roundIndex: number;
  turnId: number;
  parentId: string | null;
  branchId: string | null;
  kind: string;
  name: string;
  status: string;
  startTime: number;
  duration: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  model: string | null;
  input: string | null;
  output: string | null;
  error: string | null;
  llmThinkDuration: number | null;
  agentReplyDuration: number | null;
  toolDuration: number | null;
  details: string | null;
  content: string | null;
  isForkPoint: boolean;
}) {
  return {
    id: span.id,
    roundIndex: span.roundIndex,
    turnId: span.turnId,
    parentId: span.parentId,
    branchId: span.branchId,
    kind: span.kind,
    name: span.name,
    status: span.status,
    startTime: span.startTime * 1000,
    duration: span.duration,
    tokens: span.totalTokens > 0 ? { input: span.inputTokens, output: span.outputTokens, cacheRead: span.cacheReadTokens, cacheWrite: span.cacheWriteTokens, total: span.totalTokens } : undefined,
    model: span.model ?? undefined,
    input: span.input ?? undefined,
    output: span.output ?? undefined,
    error: span.error ?? undefined,
    llmThinkDuration: span.llmThinkDuration ?? undefined,
    agentReplyDuration: span.agentReplyDuration ?? undefined,
    toolDuration: span.toolDuration ?? undefined,
    details: span.details ?? undefined,
    content: span.content ?? undefined,
    isForkPoint: span.isForkPoint,
  };
}
