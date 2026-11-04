import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractSessionData, extractSessionRounds } from "@/lib/engine/experiment/session-data";


// 向已有实验批量追加用例（session 抽样场景）
// 不创建 ExperimentEvalResult：运行实验时会为缺失的 case×evaluator 自动补 pending 结果
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const experiment = await prisma.experiment.findUnique({
    where: { id },
    include: { cases: { select: { sessionId: true, roundIndex: true } } },
  });

  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  if (experiment.status === "running") {
    return NextResponse.json({ error: "实验运行中，无法追加用例" }, { status: 400 });
  }

  const body = await request.json();
  const { caseIds, cases } = body;

  const caseItems = cases || (caseIds?.map((sid: string) => ({ sessionId: sid })) ?? []);
  if (caseItems.length === 0) {
    return NextResponse.json({ error: "At least one case is required" }, { status: 400 });
  }

  // 按已有 (sessionId, roundIndex) 去重：多轮会话按轮拆 case（2026-11-04 口径），
  // 同一会话的每一轮是独立用例，只按 sessionId 去重会误杀第 2+ 轮
  const existingKeys = new Set(
    experiment.cases.map((c) => `${c.sessionId || ""}#${c.roundIndex ?? ""}`),
  );

  const skipped: string[] = [];
  const toCreate: { sessionId?: string; referenceOutput?: string | null }[] = [];
  for (const item of caseItems) {
    const sessionId = item.sessionId || "";
    if (sessionId && existingKeys.has(`${sessionId}#`)) {
      // 该会话已按「整会话单条」入过集（roundIndex 为空的旧行为），保持跳过
      skipped.push(sessionId);
      continue;
    }
    if (sessionId) existingKeys.add(`${sessionId}#`);
    toCreate.push(item);
  }

  if (toCreate.length === 0) {
    return NextResponse.json({ ok: true, addedCount: 0, skippedCount: skipped.length, addedCaseIds: [] });
  }

  const created = await prisma.$transaction(async (tx) => {
    const addedCaseIds: string[] = [];
    for (const item of toCreate) {
      const sessionId = item.sessionId || "";
      const rounds = sessionId ? await extractSessionRounds(sessionId) : [];
      if (rounds.length > 0) {
        for (const r of rounds) {
          const key = `${sessionId}#${r.roundIndex}`;
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);
          const row = await tx.experimentCase.create({
            data: {
              experimentId: id,
              sessionId: sessionId || null,
              roundIndex: r.roundIndex,
              input: r.input,
              actualOutput: r.actualOutput,
              referenceOutput: item.referenceOutput || null,
            },
            select: { id: true },
          });
          addedCaseIds.push(row.id);
        }
        continue;
      }
      const { input, actualOutput } = await extractSessionData(sessionId);
      const row = await tx.experimentCase.create({
        data: {
          experimentId: id,
          sessionId: sessionId || null,
          roundIndex: null,
          input,
          actualOutput,
          referenceOutput: item.referenceOutput || null,
        },
        select: { id: true },
      });
      addedCaseIds.push(row.id);
    }
    return addedCaseIds;
  });

  return NextResponse.json({
    ok: true,
    addedCount: created.length,
    skippedCount: skipped.length,
    addedCaseIds: created,
  });
}
