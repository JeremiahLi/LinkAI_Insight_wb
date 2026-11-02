/**
 * 异常分析 CLI：对指定 Agent 的运行过程给出异常链、根因假设与修复动作。
 *
 * 用法：
 *   node scripts/analyze-agent.cjs                 # 全库，近 30 天
 *   node scripts/analyze-agent.cjs <agentName>     # 指定 Agent
 *   node scripts/analyze-agent.cjs <agentName> 90  # 近 90 天
 *
 * 依赖 .tmp-verify 下的编译产物（见 npm run detect:build）。
 */
const { PrismaClient } = require("@prisma/client");
const { extractFailureChains } = require("../.tmp-verify/failure-chain.js");
const { suggestRemediation, isActionable } = require("../.tmp-verify/remediation.js");

const prisma = new PrismaClient();

const SEV_ORDER = { critical: 0, warning: 1, info: 2 };
const OUTCOME_LABEL = {
  retried_recovered: "重试自愈",
  retried_failed: "连续失败",
  abandoned: "未修复即交付",
  fatal: "致命失败",
  isolated: "孤立失败",
};

function pad(s, n) {
  const str = String(s);
  // 中文按 2 列宽估算，避免表格错位
  let w = 0;
  for (const ch of str) w += /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1;
  return str + " ".repeat(Math.max(0, n - w));
}

(async () => {
  const agentName = process.argv[2] && process.argv[2] !== "all" ? process.argv[2] : null;
  const days = Number(process.argv[3] ?? 30);
  const since = new Date(Date.now() - days * 86400_000);

  let agentIds = null;
  if (agentName) {
    const ag = await prisma.agent.findFirst({ where: { name: agentName }, select: { id: true, name: true } });
    if (!ag) {
      const all = await prisma.agent.findMany({ select: { name: true } });
      console.error(`未找到 Agent: ${agentName}`);
      console.error("可选：" + all.map((a) => a.name).join(" / "));
      process.exit(1);
    }
    agentIds = [ag.id];
  }

  const sessions = await prisma.session.findMany({
    where: { startTime: { gte: since }, ...(agentIds ? { agentId: { in: agentIds } } : {}) },
    select: { id: true, agentId: true, startTime: true, outcome: true, agent: { select: { name: true } } },
  });

  const sessionMap = new Map(sessions.map((s) => [s.id, s]));
  const ids = sessions.map((s) => s.id);

  const spans = await prisma.span.findMany({
    where: { sessionId: { in: ids }, kind: { in: ["tool_call", "command", "answer"] } },
    orderBy: [{ sessionId: "asc" }, { roundIndex: "asc" }, { turnId: "asc" }],
    select: { id: true, sessionId: true, roundIndex: true, kind: true, name: true, status: true, error: true, output: true },
  });

  const bySession = new Map();
  for (const sp of spans) {
    const arr = bySession.get(sp.sessionId) ?? [];
    arr.push(sp);
    bySession.set(sp.sessionId, arr);
  }

  const chains = [];
  for (const [sid, list] of bySession) {
    for (const c of extractFailureChains(list)) chains.push({ ...c, sessionId: sid });
  }

  const actionable = chains
    .filter((c) => isActionable(c.signature, c.outcome, c.severity))
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.attempts - a.attempts);

  const label = agentName ?? "全部 Agent";
  const sessionsWithChains = new Set(chains.map((c) => c.sessionId)).size;
  console.log(`\n=== ${label} · 近 ${days} 天 ===`);
  console.log(`会话 ${sessions.length} · 出现异常链的会话 ${sessionsWithChains}`);
  const byOutcome = chains.reduce((a, c) => ((a[c.outcome] = (a[c.outcome] ?? 0) + 1), a), {});
  console.log(
    `异常链 ${chains.length}：` +
      Object.entries(byOutcome)
        .map(([k, v]) => `${OUTCOME_LABEL[k] ?? k} ${v}`)
        .join(" / "),
  );
  console.log(`需处理 ${actionable.length} 条（已排除重试自愈与用户中止）`);

  const fam = new Map();
  for (const c of actionable) {
    const f = c.signature.family;
    const cur = fam.get(f) ?? { count: 0, sessions: new Set(), sample: c.signature.summary };
    cur.count += 1;
    cur.sessions.add(c.sessionId);
    fam.set(f, cur);
  }
  const famSorted = [...fam.entries()].sort((a, b) => b[1].count - a[1].count);

  console.log(`\n--- 问题类型排行（需处理的）---`);
  if (famSorted.length === 0) {
    console.log("  无");
  } else {
    for (const [f, v] of famSorted) {
      console.log(`  ${pad(v.count + " 条", 7)} ${pad(v.sessions.size + " 会话", 9)} ${f.slice(0, 60)}`);
      console.log(`          ${v.sample.slice(0, 100)}`);
    }
  }

  console.log(`\n--- 明细 ---`);
  const limit = Number(process.env.DETAIL_LIMIT ?? 12);
  for (const c of actionable.slice(0, limit)) {
    const rem = suggestRemediation(c.signature);
    const s = sessionMap.get(c.sessionId);
    const when = s ? new Date(s.startTime).toISOString().slice(5, 16).replace("T", " ") : "";
    console.log(
      `\n[${c.severity}] ${pad(c.signature.kind, 16)} ${when} 会话 ${c.sessionId.slice(0, 8)} round ${c.roundIndex} ${c.tool}`,
    );
    console.log(`  失败  ${c.signature.summary.slice(0, 110)}${c.signature.garbled ? "  [原文含乱码]" : ""}`);
    console.log(`  结局  ${c.followedBy}`);
    console.log(`  根因  ${rem.rootCause}（置信度 ${rem.confidence}）`);
    rem.actions.slice(0, 2).forEach((a, i) => console.log(`  建议${i + 1} ${a}`));
  }
  if (actionable.length > limit) {
    console.log(`\n... 还有 ${actionable.length - limit} 条（DETAIL_LIMIT 可调）`);
  }

  await prisma.$disconnect();
})();
