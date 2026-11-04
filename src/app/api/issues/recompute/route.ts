import { NextResponse } from "next/server";
import { recomputeIssuesForAgent } from "@/lib/engine/issues/recompute";

/**
 * 问题单重算（PLAN M1.4）：POST /api/issues/recompute
 * body: { agentName: string, rangeDays?: number }（rangeDays 0 = 全历史）
 * 按 detect 层失败链重跑，upsert 到 Issue（agentId + fingerprint 幂等去重）。
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { agentName?: string; rangeDays?: number }
    | null;

  if (!body?.agentName) {
    return NextResponse.json({ error: "agentName is required" }, { status: 400 });
  }
  const rangeDays = Number.isFinite(body.rangeDays) ? Math.max(0, Math.trunc(body.rangeDays!)) : 30;

  try {
    const result = await recomputeIssuesForAgent(body.agentName, rangeDays);
    if (!result) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[issues/recompute] " + message);
    return NextResponse.json({ error: "Recompute failed", detail: message }, { status: 500 });
  }
}
