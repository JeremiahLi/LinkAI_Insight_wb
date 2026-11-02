import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildRecurrence, weekBuckets } from "@/lib/engine/detect/recurrence";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_WEEKS = new Set([4, 8, 12, 26]);

/** Next 已解码过一次 URL 段，再解一次遇含 % 的名字会抛 URIError */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 症状复发：同一失败家族在最近 N 周里的出现次数与触发率。
 *
 * 与 /issues 的分工：那边回答「现在有什么问题、根因是什么」，
 * 这里回答「这个问题是不是反复出现、上个月到现在有没有真的消停」。
 * 注意「本周期没出现」不等于修好了 —— 必须同时给分母（接口调用次数）。
 */
export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { searchParams } = new URL(request.url);
  const weeks = Number(searchParams.get("weeks") ?? 8);
  if (!ALLOWED_WEEKS.has(weeks)) {
    return NextResponse.json(
      { error: `weeks=${weeks} 暂不支持，可用值：4 / 8 / 12 / 26` },
      { status: 400 },
    );
  }

  const { name } = await params;
  const agentName = safeDecode(name);

  const agent = await prisma.agent.findUnique({ where: { name: agentName }, select: { id: true, name: true } });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const nowMs = Date.now();
  const weekStarts = weekBuckets(weeks, nowMs);
  const startMs = weekStarts[0];

  try {
    // 成败都要取：失败用于统计出现次数，成功用于分母（触发率）。
    // 坑：Span.startTime 是 Int **Unix 秒**（实测 1793003543 → 2026-10-27），
    // 而 Session.startTime 是 DateTime。这里按秒过滤、读出后 ×1000 转毫秒。
    const startSec = Math.floor(startMs / 1000);
    const spans = await prisma.span.findMany({
      where: {
        session: { agentId: agent.id },
        kind: { in: ["tool_call", "command"] },
        startTime: { gte: startSec },
      },
      select: { id: true, sessionId: true, name: true, status: true, error: true, startTime: true },
    });

    const report = buildRecurrence(
      spans.map((s) => ({
        id: s.id,
        sessionId: s.sessionId,
        name: s.name,
        status: s.status,
        error: s.error,
        at: s.startTime * 1000,
      })),
      weeks,
      nowMs,
    );

    // 窗口内会话数（分母背景：多少会话里出现过症状）
    const sessionCount = await prisma.session.count({
      where: { agentId: agent.id, startTime: { gte: new Date(startMs) } },
    });

    return NextResponse.json({
      ...report,
      agentName: agent.name,
      sessionCount,
      startMs,
      endMs: nowMs + WEEK_MS,
      spanCount: spans.length,
    });
  } catch (err) {
    console.error("[agent-recurrence] 统计失败", agentName, err);
    return NextResponse.json(
      { error: "复发统计失败", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
