/**
 * 数据体检脚本（PLAN M0.4）：输出采集与口径健康的基线报告。
 *
 * 每次采集端契约或口径变更后复跑，用数字验证修正是否生效：
 *   node scripts/data-health.cjs [--json]
 *
 * 指标（全部实测自 dev.db，不估算）：
 *   A. answer 空值率 —— 采集端/口径层级的缺陷信号（PLAN 缺陷 A：曾为 26.3%）
 *   B. 假失败候选 —— 末条 answer 空但历史有交付且无新追问的会话数
 *      （computeOutcome 的 truncated 口径独立复算，两份实现互为校验）
 *   C. outcome 分布 + 按新口径的成功率
 *   D. 版本维度覆盖率 —— Session.agentVersion / promptHash 非空占比
 *      （采集端 session_start 契约生效后应显著大于 0；全库 session_start span
 *        恒为 0 属预期：upload.cjs 会消费它提升为 payload 顶层字段）
 *   E. 用例抽取口径验证 —— 多轮会话按轮拆分后，轮次问答对的非空率
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const AS_JSON = process.argv.includes("--json");

function pct(num, den) {
  if (!den) return "n/a";
  return ((num / den) * 100).toFixed(1) + "%";
}

(async () => {
  const [totalSessions, totalSpans, answerSpans, emptyAnswerSpans, sessionStartSpans] =
    await Promise.all([
      prisma.session.count(),
      prisma.span.count(),
      prisma.span.count({ where: { kind: "answer" } }),
      prisma.span.count({ where: { kind: "answer", output: "" } }),
      prisma.span.count({ where: { kind: "session_start" } }),
    ]);

  // ---- B. 假失败候选（与 derive.computeOutcome 的 truncated 判定同规则）----
  const answerRows = await prisma.span.findMany({
    where: { kind: "answer" },
    select: { sessionId: true, kind: true, roundIndex: true, turnId: true, status: true, output: true },
    orderBy: [{ sessionId: "asc" }, { roundIndex: "asc" }, { turnId: "asc" }],
  });
  const userRows = await prisma.span.findMany({
    where: { kind: "user" },
    select: { sessionId: true, kind: true, roundIndex: true, turnId: true },
    orderBy: [{ sessionId: "asc" }, { roundIndex: "asc" }, { turnId: "asc" }],
  });

  // 每会话：answer 序列（有序）与 user 的有序扁平序列（用于「交付后有无新追问」）
  const answersBySession = new Map();
  for (const r of answerRows) {
    if (!answersBySession.has(r.sessionId)) answersBySession.set(r.sessionId, []);
    answersBySession.get(r.sessionId).push(r);
  }
  const orderedRowsBySession = new Map();
  for (const r of [...answerRows, ...userRows]) {
    if (!orderedRowsBySession.has(r.sessionId)) orderedRowsBySession.set(r.sessionId, []);
    orderedRowsBySession.get(r.sessionId).push(r);
  }
  for (const arr of orderedRowsBySession.values()) {
    arr.sort((a, b) => (a.roundIndex || 0) - (b.roundIndex || 0) || (a.turnId || 0) - (b.turnId || 0));
  }

  let truncatedCandidates = 0;
  const truncatedSamples = [];
  for (const [sessionId, rows] of orderedRowsBySession) {
    const answers = rows.filter((r) => r.kind === "answer");
    if (answers.length === 0) continue;
    const last = answers[answers.length - 1];
    // 与 derive.computeOutcome 一致：末条 answer 只要「无交付」（status=failed 或输出为空）
    // 就进入 truncated 判定，不能按 status 预先剔除 —— 缺陷 C 的主体正是 status=failed 的空 answer
    if (String(last.output || "").trim() !== "" && last.status !== "failed") continue;
    // 末条 answer 空：找历史非空交付
    let lastDeliveredIdx = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      const s = rows[i];
      if (s.kind === "answer" && s.status !== "failed" && String(s.output || "").trim() !== "") {
        lastDeliveredIdx = i;
        break;
      }
    }
    if (lastDeliveredIdx < 0) continue;
    const hasNewAsk = rows.slice(lastDeliveredIdx + 1).some((r) => r.kind === "user");
    if (hasNewAsk) continue;
    truncatedCandidates++;
    if (truncatedSamples.length < 5) truncatedSamples.push(sessionId);
  }

  // ---- C. outcome 分布 + 新口径成功率 ----
  const outcomeGroups = await prisma.session.groupBy({ by: ["outcome"], _count: { _all: true } });
  const outcomeDist = {};
  for (const g of outcomeGroups) outcomeDist[g.outcome === "" ? "(空)" : g.outcome] = g._count._all;

  const [finished, bad, partial] = await Promise.all([
    prisma.session.count({ where: { NOT: { status: "active" }, OR: [{ outcome: { not: "" } }, { totalSpans: { gt: 0 } }] } }),
    prisma.session.count({ where: { OR: [{ outcome: { in: ["failed", "truncated"] } }, { outcome: "", errorCount: { gt: 0 } }, { outcome: "", status: "error" }] } }),
    prisma.session.count({ where: { outcome: "partial" } }),
  ]);
  const successRate = finished ? ((1 - (bad + partial * 0.5) / finished) * 100).toFixed(1) + "%" : "n/a";

  // ---- D. 版本维度覆盖率 ----
  const [verSet, hashSet, verTotal] = await Promise.all([
    prisma.session.count({ where: { agentVersion: { not: "" } } }),
    prisma.session.count({ where: { promptHash: { not: "" } } }),
    prisma.session.count(),
  ]);

  // ---- E. 按轮抽取验证（PLAN 0.1 验收：多轮会话拆分后非空率 ≥ 95%）----
  const spanRows = await prisma.span.findMany({
    select: { sessionId: true, kind: true, roundIndex: true, input: true, output: true },
  });
  const spansBySession = new Map();
  for (const s of spanRows) {
    if (!spansBySession.has(s.sessionId)) spansBySession.set(s.sessionId, []);
    spansBySession.get(s.sessionId).push(s);
  }
  let multiRoundSessions = 0;
  let roundPairs = 0;
  let roundPairsValid = 0;
  for (const list of spansBySession.values()) {
    const rounds = new Set();
    let userRounds = new Set();
    for (const s of list) {
      if (s.kind === "user" || s.kind === "answer") rounds.add(s.roundIndex || 0);
      if (s.kind === "user" && String(s.input || "").trim()) userRounds.add(s.roundIndex || 0);
    }
    if (userRounds.size < 2) continue; // 只验多轮会话
    multiRoundSessions++;
    for (const round of rounds) {
      const inRound = list.filter((s) => (s.roundIndex || 0) === round);
      const input = inRound.find((s) => s.kind === "user" && String(s.input || "").trim());
      const answers = inRound.filter((s) => s.kind === "answer");
      if (answers.length === 0) continue; // 未回答的末轮（进行中/截断）不产 case，不入分母
      const hasNonEmpty = answers.some((s) => String(s.output || "").trim());
      if (input && hasNonEmpty) roundPairsValid++;
      roundPairs++;
    }
  }

  // ---- F. 闭环验收（PLAN M2）：fixed 的问题单应至少关联 1 个回归用例 ----
  const issues = await prisma.issue.findMany({
    select: { id: true, status: true, title: true, caseIdsJson: true },
  });
  const fixedIssues = issues.filter((i) => i.status === "fixed");
  const fixedNoCase = fixedIssues.filter((i) => {
    try {
      const arr = JSON.parse(i.caseIdsJson || "[]");
      return !Array.isArray(arr) || arr.length === 0;
    } catch {
      return true;
    }
  });

  const report = {
    generatedAt: new Date().toISOString(),
    A_answerEmptyRate: {
      answerSpans,
      emptyAnswerSpans,
      rate: pct(emptyAnswerSpans, answerSpans),
    },
    B_truncatedCandidates: {
      count: truncatedCandidates,
      rate: pct(truncatedCandidates, totalSessions),
      samples: truncatedSamples,
      note: "末条 answer 空 + 此前有交付 + 无新追问；与 derive.computeOutcome 的 truncated 口径同规则",
    },
    C_outcome: {
      dist: outcomeDist,
      finished,
      bad: bad + "（含 truncated）",
      partial,
      successRate_new: successRate,
      note: "成功率 = 1 - (bad + partial*0.5) / finished，partial 仅计未自愈失败（derive.computeOutcome 新口径）",
    },
    D_versionCoverage: {
      agentVersion: `${verSet}/${verTotal} (${pct(verSet, verTotal)})`,
      promptHash: `${hashSet}/${verTotal} (${pct(hashSet, verTotal)})`,
      sessionStartSpans: sessionStartSpans + "（恒为 0 属预期：upload.cjs 消费后提升为 payload 顶层）",
    },
    E_roundExtraction: {
      multiRoundSessions,
      roundPairs,
      roundPairsValid,
      validRate: pct(roundPairsValid, roundPairs),
      acceptance: "≥95%",
    },
    F_closedLoop: {
      fixedIssues: fixedIssues.length,
      fixedWithoutCase: fixedNoCase.length,
      samples: fixedNoCase.slice(0, 5).map((i) => ({ id: i.id, title: i.title.slice(0, 60) })),
      acceptance: "fixed 问题单应至少关联 1 个回归用例",
    },
  };

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("== 数据体检报告 ==");
    console.log(`会话 ${totalSessions} · span ${totalSpans}`);
    console.log(`\n[A] answer 空值率：${report.A_answerEmptyRate.rate}（${emptyAnswerSpans}/${answerSpans}）`);
    console.log(`[B] 假失败候选（truncated 口径）：${truncatedCandidates}（${report.B_truncatedCandidates.rate}）`);
    truncatedSamples.forEach((id) => console.log(`    样例 ${id}`));
    console.log(`[C] outcome 分布：${JSON.stringify(outcomeDist)}`);
    console.log(`    新口径成功率：${successRate}（finished ${finished} / bad ${bad} / partial ${partial}）`);
    console.log(`[D] 版本覆盖：agentVersion ${report.D_versionCoverage.agentVersion} · promptHash ${report.D_versionCoverage.promptHash} · session_start span ${sessionStartSpans}`);
    console.log(`[E] 按轮抽取非空率：${report.E_roundExtraction.validRate}（${roundPairsValid}/${roundPairs}，多轮会话 ${multiRoundSessions}，验收 ≥95%）`);
    console.log(`[F] 闭环验收：fixed ${fixedIssues.length} 个，其中缺回归用例 ${fixedNoCase.length} 个（验收 0）`);
    fixedNoCase.slice(0, 5).forEach((i) => console.log(`    缺用例 ${i.id} ${i.title.slice(0, 50)}`));
  }
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
