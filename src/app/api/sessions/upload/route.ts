import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function POST(request: Request) {
  let body: {
    sessionID?: string;
    userId?: string;
    projectId?: string;
    startedAt?: string;
    endedAt?: string;
    model?: string;
    rawData?: string;
    spans?: Array<{
      spanId?: string;
      kind?: string;
      name?: string;
      status?: string;
      roundIndex?: number;
      turnId?: number;
      input?: string | null;
      output?: string | null;
      tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number } | null;
      model?: string | null;
      toolCallId?: string | null;
      toolName?: string | null;
      isError?: boolean;
      duration?: number | null;
      llmThinkDuration?: number | null;
      agentReplyDuration?: number | null;
      toolDuration?: number | null;
      details?: string | null;
      content?: string | null;
      agent_name?: string;
      agent_id?: string;
      agent_version?: string;
      createdAt?: string;
    }>;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionID, userId, projectId, startedAt, endedAt, model, rawData } = body;

  if (!sessionID || !userId || !projectId) {
    return NextResponse.json(
      { error: "Missing required fields: sessionID, userId, projectId" },
      { status: 400 }
    );
  }

  const inSpans = body.spans || [];

// 数值字段收敛：旧版采集端（2026-07 前）会把 turnId 写成字符串（如 "loop-xxx#0"），
// 其他数值字段也可能因历史格式异常传入非数字。Prisma Int 列校验严格，
// 不收敛会导致整个会话 createMany 报 500。非数字/NaN 一律回退默认值。
function toIntOr(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return fallback;
}

  var sessionStartSpan = inSpans.find(function(s: any) { return s.kind === 'session_start'; });
  var agentName = (sessionStartSpan && sessionStartSpan.agent_name) || 'pi-coding-agent';

  // session.startTime 兜底：会话不可能晚于自己最早的一条 Span 开始。
  // 若 payload 的 startedAt 晚于最早 Span（例如采集端把首次上传时间当作 startedAt），
  // 以最早 Span 为准；两者都没有时才退回当前时间。
  const earliestSpanMs = inSpans.reduce((min, s) => {
    if (!s.createdAt) return min;
    const t = new Date(s.createdAt).getTime();
    return Number.isFinite(t) && (min === Infinity || t < min) ? t : min;
  }, Infinity as number);
  const resolvedStartMs = (() => {
    const startedAtMs = startedAt ? new Date(startedAt).getTime() : NaN;
    const hasSpan = Number.isFinite(earliestSpanMs);
    if (Number.isFinite(startedAtMs) && hasSpan) return Math.min(startedAtMs, earliestSpanMs);
    if (Number.isFinite(startedAtMs)) return startedAtMs;
    if (hasSpan) return earliestSpanMs;
    return null; // 无法确定时不下发，避免把 startTime 覆盖成入库时间
  })();
  var agentId = (sessionStartSpan && sessionStartSpan.agent_id) || null;
  var agentVersion = (sessionStartSpan && sessionStartSpan.agent_version) || '1.0.0';

  try {
    const { id: userIdDb } = await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, name: userId, org: "" },
    });

    const agent = await prisma.agent.upsert({
      where: { name: agentName },
      update: { version: agentVersion },
      create: {
        id: agentId || undefined,
        name: agentName,
        version: agentVersion,
        emoji: "🤖",
        description: "",
        framework: "pi-coding-agent",
      },
    });

    const { id: projectIdDb } = await prisma.project.upsert({
      where: { id: projectId },
      update: {},
      create: { id: projectId, name: projectId, userId: userIdDb, agentId: agent.id },
    });

    // 1. 先确保 session 存在（用最小的数据 insert，不覆盖统计字段）
    const startFallback = resolvedStartMs != null ? { startTime: new Date(resolvedStartMs) } : {};
    await prisma.session.upsert({
      where: { id: sessionID },
      // startTime 修正：若 payload 带了 startedAt，或此前误用入库时间落库，则用正确基准刷新
      update: startFallback,
      create: {
        id: sessionID,
        projectId: projectIdDb,
        userId: userIdDb,
        agentId: agent.id,
        status: "active",
        startTime: new Date(resolvedStartMs ?? Date.now()),
        endTime: endedAt ? new Date(endedAt) : new Date(),
        rawData: rawData ?? null,
      },
    });

    // 2. 增量 upsert spans，按 id 去重并更新字段
    let insertedNew = 0;
    let updated = 0;
    if (inSpans.length > 0) {
      // 构造 span 数据
      const data = inSpans.map((s) => ({
        id: s.spanId || crypto.randomUUID(),
        sessionId: sessionID,
        roundIndex: toIntOr(s.roundIndex, 0),
        turnId: toIntOr(s.turnId, 0),
        kind: s.kind || "user",
        name: s.name || "",
        status: s.status || "success",
        startTime: s.createdAt
          ? Math.floor(new Date(s.createdAt).getTime() / 1000) || 0
          : 0,
        duration: toIntOr(s.duration, 0),
        inputTokens: toIntOr(s.tokens?.input, 0),
        outputTokens: toIntOr(s.tokens?.output, 0),
        cacheReadTokens: toIntOr(s.tokens?.cacheRead, 0),
        cacheWriteTokens: toIntOr(s.tokens?.cacheWrite, 0),
        totalTokens: toIntOr(s.tokens?.total, 0),
        model: s.model ?? null,
        input: s.input ?? null,
        output: s.output ?? null,
        error: s.isError ? (s.output ?? null) : null,
        llmThinkDuration: s.llmThinkDuration ?? null,
        agentReplyDuration: s.agentReplyDuration ?? null,
        toolDuration: s.toolDuration ?? null,
        details: s.details ?? null,
        content: s.content ?? null,
      }));

      // 查出已存在的 span id
      const incomingIds = data.map((d) => d.id);
      const existing = await prisma.span.findMany({
        where: { id: { in: incomingIds } },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((e) => e.id));

      const toInsert = [];
      const toUpdate = [];
      for (const d of data) {
        if (existingIds.has(d.id)) toUpdate.push(d);
        else toInsert.push(d);
      }

      // SQLite 不支持 createMany 的 skipDuplicates，所以拆成 insert 列表
      if (toInsert.length > 0) {
        const BATCH = 200;
        for (let i = 0; i < toInsert.length; i += BATCH) {
          const batch = toInsert.slice(i, i + BATCH);
          const result = await prisma.span.createMany({ data: batch });
          insertedNew += result.count;
        }
      }

      // 对已存在的 span，用原生 SQL 批量 upsert（比逐条 update 快）
      // 先删除再批量插入，确保幂等
      if (toUpdate.length > 0) {
        await prisma.span.deleteMany({
          where: { id: { in: toUpdate.map((d) => d.id) } },
        });
        const BATCH = 200;
        for (let i = 0; i < toUpdate.length; i += BATCH) {
          const batch = toUpdate.slice(i, i + BATCH);
          await prisma.span.createMany({ data: batch });
          updated += batch.length;
        }
      }
    }

    const insertedCount = insertedNew;

    // 3. 从 DB 重新统计该 session 的实际数据，更新 session 字段
    const allSpans = await prisma.span.findMany({
      where: { sessionId: sessionID },
      select: {
        roundIndex: true,
        kind: true,
        status: true,
        duration: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
        totalTokens: true,
      },
    });

    const roundIndices = new Set<number>();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheWriteTokens = 0;
    let totalDuration = 0;
    let errorCount = 0;

    for (const sp of allSpans) {
      roundIndices.add(sp.roundIndex);
      if (sp.status === "failed") errorCount++;
      totalDuration += sp.duration;
      totalInputTokens += sp.inputTokens;
      totalOutputTokens += sp.outputTokens;
      totalCacheReadTokens += sp.cacheReadTokens;
      totalCacheWriteTokens += sp.cacheWriteTokens;
    }

    const totalTokens = totalInputTokens + totalOutputTokens + totalCacheReadTokens + totalCacheWriteTokens;

    // 只允许 round/spans 数值增长，防止并发上传时用旧数据覆盖新数据
    const existingSession = await prisma.session.findUnique({
      where: { id: sessionID },
      select: { totalRounds: true, totalSpans: true },
    });

    await prisma.session.update({
      where: { id: sessionID },
      data: {
        status: "completed",
        model: model || "",
        endTime: endedAt ? new Date(endedAt) : new Date(),
        totalRounds: Math.max(roundIndices.size, existingSession?.totalRounds ?? 0),
        totalSpans: Math.max(allSpans.length, existingSession?.totalSpans ?? 0),
        errorCount,
        totalInputTokens,
        totalOutputTokens,
        totalCacheReadTokens,
        totalCacheWriteTokens,
        totalTokens,
        totalDuration,
      },
    });

    return NextResponse.json({
      ok: true,
      sessionId: sessionID,
      totalSpans: allSpans.length,
      insertedNew: insertedCount,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[upload] " + message, stack);
    return NextResponse.json({ error: "Upload failed", detail: message, stack }, { status: 500 });
  }
}
