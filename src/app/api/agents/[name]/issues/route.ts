import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRange } from "@/lib/engine/stats/range";
import { getAgentFailureReport } from "@/lib/engine/detect/agent-failures";

const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_RANGES = new Set(["realtime", "3d", "weekly", "30d", "all"]);
const DEFAULT_RANGE = "30d";

/** Next 已解码过一次 URL 段，再解一次遇含 % 的名字会抛 URIError */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Agent 运行异常分析（过程链路级）。
 * 与 /api/dashboard/agents/[name] 的 issues 区别：那边是统计聚合（失败率、错误聚类），
 * 这里是失败链（失败 → 重试 → 结局 + 根因 + 修复建议）。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("range") ?? DEFAULT_RANGE;

  if (!ALLOWED_RANGES.has(raw)) {
    return NextResponse.json(
      { error: `range=${raw} 暂不支持，可用值：realtime / 3d / weekly / 30d / all` },
      { status: 400 },
    );
  }

  const { name } = await params;
  const agentName = safeDecode(name);
  const range = resolveRange(raw);

  let startMs = range.startMs;
  if (raw === "all") {
    // 全历史：以该 Agent 首个会话为起点，避免把 1970 年算进窗口
    const first = await prisma.session.findFirst({
      where: { agent: { name: agentName } },
      orderBy: { startTime: "asc" },
      select: { startTime: true },
    });
    startMs = first ? new Date(first.startTime).getTime() : Date.now() - 7 * DAY_MS;
  }

  try {
    const report = await getAgentFailureReport(agentName, { startMs });
    if (!report) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    return NextResponse.json({
      ...report,
      range: range.label,
      rangeKey: raw,
    });
  } catch (err) {
    console.error("[agent-issues] 分析失败", agentName, err);
    return NextResponse.json(
      { error: "异常分析失败", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
