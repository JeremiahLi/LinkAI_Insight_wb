import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** 快照里单字段截断上限：保证据可读，防 JSON 膨胀 */
const SNAPSHOT_FIELD_MAX = 500;
const SNAPSHOT_SPAN_MAX = 80;

function trunc(s: string | null | undefined): string {
  const t = String(s ?? "");
  return t.length <= SNAPSHOT_FIELD_MAX ? t : t.slice(0, SNAPSHOT_FIELD_MAX) + "…[截断]";
}

/** 字符 3-gram Jaccard 相似度：粗粒度，只为「建议合并」提示，不做自动合并 */
function trigramJaccard(a: string, b: string): number {
  const grams = (s: string) => {
    const set = new Set<string>();
    const t = s.replace(/\s+/g, "");
    for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3));
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

/**
 * 从问题单生成回归用例（PLAN M2.1 + M2.3 + M2.4）。
 *
 * body: { experimentId, expectedBehavior? }
 *
 * - M2.3 轨迹证据固化：把代表会话的 span 序列快照写进 evaluatorContextJson，
 *   原会话被清理后 case 仍能独立完成评测；
 * - M2.4 去重：同一 (srcIssueId, experimentId) 不重复建。
 *
 * input 取失败前最近的用户诉求（回归的是「这个诉求当时做错了」），
 * actualOutput 取该会话末条非空交付（做了什么），expectedBehavior 缺省为
 * 「不再复现：<问题标题>」。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | { experimentId?: string; expectedBehavior?: string }
    | null;

  if (!body?.experimentId) {
    return NextResponse.json({ error: "experimentId is required" }, { status: 400 });
  }

  const issue = await prisma.issue.findUnique({ where: { id } });
  if (!issue) return NextResponse.json({ error: "Issue not found" }, { status: 404 });

  const experiment = await prisma.experiment.findUnique({
    where: { id: body.experimentId },
    select: { id: true, name: true, status: true },
  });
  if (!experiment) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  if (experiment.status === "running") {
    return NextResponse.json({ error: "实验运行中，无法追加用例" }, { status: 400 });
  }

  // M2.4 去重：同一问题单在同一实验里只入集一次
  const dup = await prisma.experimentCase.findFirst({
    where: { experimentId: experiment.id, srcIssueId: issue.id },
    select: { id: true },
  });
  if (dup) {
    return NextResponse.json({
      ok: true,
      created: 0,
      caseId: dup.id,
      message: "该问题单已在此实验中，未重复创建",
    });
  }

  // 代表样例：证据第一条（重算时按严重度排过序）
  let evidence: {
    sessionId: string;
    spanId?: string;
    summary?: string;
    outcome?: string;
    attempts?: number;
  }[] = [];
  try {
    evidence = JSON.parse(issue.evidenceJson || "[]");
  } catch {
    evidence = [];
  }
  const sample = evidence[0] ?? null;
  const sessionId = sample?.sessionId ?? issue.sessionId;
  if (!sessionId) {
    return NextResponse.json(
      { error: "该问题单没有可用的样例会话，无法生成用例" },
      { status: 400 },
    );
  }

  const spans = await prisma.span.findMany({
    where: { sessionId },
    orderBy: [{ roundIndex: "asc" }, { turnId: "asc" }],
    select: {
      id: true,
      kind: true,
      name: true,
      status: true,
      roundIndex: true,
      turnId: true,
      input: true,
      output: true,
      error: true,
      duration: true,
    },
  });
  if (spans.length === 0) {
    return NextResponse.json({ error: "样例会话在库中没有 span，无法固化证据" }, { status: 400 });
  }

  // 失败轮次：按样例 spanId 定位；找不到（会话被清理）取末轮
  let failureRound: number | null = null;
  if (sample?.spanId) {
    const hit = spans.find((s) => s.id === sample.spanId);
    if (hit) failureRound = hit.roundIndex;
  }

  // input：回归用例必须有完整任务背景。实测续跑轮的 user span 只有「好」「继续」
  // （与 diagnose 链路 taskIntent 的坑同源），所以取首条有实质内容（≥20 字）的
  // 用户诉求，没有再退首条 user、再退问题标题。
  const MIN_ASK_LEN = 20;
  const userInputs = spans.filter((s) => s.kind === "user" && (s.input ?? "").trim());
  const substantialAsk = userInputs.find((s) => (s.input ?? "").trim().length >= MIN_ASK_LEN);
  const input = (
    substantialAsk?.input ??
    userInputs[0]?.input ??
    issue.title
  ).trim();

  // actualOutput：末条非空交付（当时实际做了什么）；无交付则用证据摘要
  const answers = spans.filter((s) => s.kind === "answer" && (s.output ?? "").trim());
  const actualOutput = (answers[answers.length - 1]?.output ?? sample?.summary ?? "").trim();

  const expectedBehavior = (body.expectedBehavior ?? "").trim() || `不再复现：${issue.title}`;

  // M2.3 轨迹快照：截断后固化，原会话删除后仍可独立评测
  const snapshot = {
    snapshotAt: new Date().toISOString(),
    srcIssue: { id: issue.id, fingerprint: issue.fingerprint, title: issue.title },
    failureRound,
    spans: spans.slice(0, SNAPSHOT_SPAN_MAX).map((s) => ({
      id: s.id,
      kind: s.kind,
      name: s.name,
      status: s.status,
      roundIndex: s.roundIndex,
      turnId: s.turnId,
      input: trunc(s.input),
      output: trunc(s.output),
      error: trunc(s.error),
      duration: s.duration,
    })),
    truncated: spans.length > SNAPSHOT_SPAN_MAX,
  };

  const created = await prisma.experimentCase.create({
    data: {
      experimentId: experiment.id,
      sessionId,
      roundIndex: failureRound,
      srcIssueId: issue.id,
      expectedBehavior,
      input,
      actualOutput,
      evaluatorContextJson: JSON.stringify(snapshot),
    },
    select: { id: true },
  });

  // 回写问题单的关联 case 列表
  const caseIds: string[] = (() => {
    try {
      const arr = JSON.parse(issue.caseIdsJson || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  })();
  caseIds.push(created.id);
  await prisma.issue.update({ where: { id: issue.id }, data: { caseIdsJson: JSON.stringify(caseIds) } });

  // M2.4 相似提示：与同实验既有用例的 input 比较，>0.9 提示人工合并（不自动动数据）
  const siblingCases = await prisma.experimentCase.findMany({
    where: { experimentId: experiment.id, id: { not: created.id } },
    select: { id: true, input: true },
    take: 200,
  });
  let similar: { caseId: string; input: string; similarity: number } | null = null;
  for (const s of siblingCases) {
    const sim = trigramJaccard(input, s.input);
    if (sim > 0.9 && (!similar || sim > similar.similarity)) {
      similar = { caseId: s.id, input: s.input.slice(0, 120), similarity: Number(sim.toFixed(3)) };
    }
  }

  return NextResponse.json({
    ok: true,
    created: 1,
    caseId: created.id,
    experimentId: experiment.id,
    experimentName: experiment.name,
    snapshotSpans: Math.min(spans.length, SNAPSHOT_SPAN_MAX),
    ...(similar ? { similar, message: `与既有用例相似度 ${similar.similarity}（>0.9），建议人工合并` } : {}),
  });
}
