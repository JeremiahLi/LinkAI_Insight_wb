/**
 * 一次性维护脚本：修正 Session.startTime
 *
 * 背景：早期上传接口在 payload 未带 startedAt 时，会把 session.startTime
 * 落库为"入库时间"（晚于实际会话开始），导致 Trace 时间线整体漂移。
 * 本脚本把每个 Session 的 startTime 纠正为该 Session 最早 Span 的开始时间
 * （endTime 纠正为最晚 Span 结束时间，若比当前值更晚）。
 *
 * 用法：node scripts/fix-session-starttime.js
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const sessions = await prisma.session.findMany({
    select: { id: true, startTime: true, endTime: true },
  });

  let fixed = 0;
  for (const s of sessions) {
    const spans = await prisma.span.findMany({
      where: { sessionId: s.id },
      select: { startTime: true, duration: true },
    });
    if (spans.length === 0) continue;

    const minStartMs = Math.min(...spans.map((x) => x.startTime)) * 1000;
    const maxEndMs = Math.max(...spans.map((x) => x.startTime * 1000 + x.duration));

    // Span 时间戳无效（如 seed 数据写死 0/100，早于 2001 年）时不修正，
    // 否则会把 session.startTime 误改成 1970 年。
    if (minStartMs < 1000000000000) continue;

    const data = {};
    if (Math.abs(new Date(s.startTime).getTime() - minStartMs) > 1000) {
      data.startTime = new Date(minStartMs);
    }
    if (!s.endTime || new Date(s.endTime).getTime() < maxEndMs - 1000) {
      data.endTime = new Date(maxEndMs);
    }
    if (Object.keys(data).length === 0) continue;

    await prisma.session.update({ where: { id: s.id }, data });
    fixed++;
    console.log(
      `fixed ${s.id}: startTime ${new Date(s.startTime).toISOString()} -> ${new Date(minStartMs).toISOString()}`,
    );
  }
  console.log(`done. ${fixed}/${sessions.length} sessions fixed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
