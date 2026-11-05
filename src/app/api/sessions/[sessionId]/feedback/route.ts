import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ALLOWED_KINDS = new Set(["thumbs_up", "thumbs_down", "reask", "abandon", "adopt"]);

/** 用户信号上报（PLAN M4.3）。machine 判断走 scripts/detect-abandon.cjs（by=auto） */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const body = (await request.json().catch(() => null)) as
    | { kind?: string; note?: string; by?: string }
    | null;

  if (!body?.kind || !ALLOWED_KINDS.has(body.kind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${[...ALLOWED_KINDS].join(", ")}` },
      { status: 400 },
    );
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const feedback = await prisma.sessionFeedback.create({
    data: {
      sessionId,
      kind: body.kind,
      note: (body.note ?? "").slice(0, 500),
      by: (body.by ?? "").slice(0, 100) || "user",
    },
  });

  return NextResponse.json({ ok: true, id: feedback.id, kind: feedback.kind });
}

/** 该会话的既有信号（详情页回显用） */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const list = await prisma.sessionFeedback.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(list);
}
