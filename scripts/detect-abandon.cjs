/**
 * 放弃检测（PLAN M4.4）：span 间隔 > 10 分钟且末轮无有效 answer → 推断用户放弃，
 * 写入 SessionFeedback（kind=abandon, by=auto）。幂等：同一会话已有 abandon 信号不重复写。
 *
 * 判定口径（宁可少报不误报）：
 * - 会话非 active（已结束）；
 * - 末条 span 与其前一条 span 之间间隔 > 10 分钟（用户等了很久）；
 * - 末条 span 之后没有非空 answer（即末轮没有交付）——
 *   「末条 span 是 user」或「末条 answer 为空」都算；
 * - 排除会话末条本身就是空 answer 且前一条也是 answer 的噪声形态（采集端收尾补写）。
 *
 * 用法：
 *   node scripts/detect-abandon.cjs            # dry-run
 *   node scripts/detect-abandon.cjs --apply    # 写入
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ABANDON_GAP_MS = 10 * 60 * 1000;

(async () => {
  console.log(APPLY ? "== 写入模式 ==" : "== DRY-RUN（加 --apply 执行）==");

  const sessions = await prisma.session.findMany({
    where: { status: { not: "active" } },
    select: { id: true, title: true, agent: { select: { name: true } } },
  });

  // 已有 abandon 信号的会话不重复判
  const existing = new Set(
    (
      await prisma.sessionFeedback.findMany({
        where: { kind: "abandon" },
        select: { sessionId: true },
      })
    ).map((f) => f.sessionId),
  );

  const spans = await prisma.span.findMany({
    select: { sessionId: true, kind: true, status: true, roundIndex: true, turnId: true, startTime: true, output: true },
    orderBy: [{ sessionId: "asc" }, { roundIndex: "asc" }, { turnId: "asc" }],
  });
  const bySession = new Map();
  for (const s of spans) {
    if (!bySession.has(s.sessionId)) bySession.set(s.sessionId, []);
    bySession.get(s.sessionId).push(s);
  }

  let candidates = 0;
  let written = 0;
  for (const ses of sessions) {
    if (existing.has(ses.id)) continue;
    const list = bySession.get(ses.id) || [];
    if (list.length < 2) continue;
    const last = list[list.length - 1];
    const prev = list[list.length - 2];
    // 末轮无有效交付：末条不是非空 answer
    const lastHasDelivery = last.kind === "answer" && last.status !== "failed" && String(last.output || "").trim() !== "";
    if (lastHasDelivery) continue;
    // 间隔判定：startTime 是 Unix 秒
    const gapMs = (last.startTime - prev.startTime) * 1000;
    if (gapMs <= ABANDON_GAP_MS) continue;
    candidates++;
    console.log(`  ${ses.agent.name.padEnd(20)} gap ${Math.round(gapMs / 60000)}min · ${ses.id.slice(0, 8)} ${(ses.title || "").slice(0, 40)}`);
    if (APPLY) {
      await prisma.sessionFeedback.create({
        data: { sessionId: ses.id, kind: "abandon", by: "auto", note: `末轮无交付，间隔 ${Math.round(gapMs / 60000)} 分钟` },
      });
      written++;
    }
  }

  console.log(`\n候选 ${candidates} 个${APPLY ? `，写入 ${written} 条 abandon 信号` : "（dry-run 未写入）"}`);
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
