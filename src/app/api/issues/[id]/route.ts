import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ALLOWED_STATUS = new Set(["open", "ack", "fixed", "wontfix", "stale"]);

/**
 * 问题单生命周期（PLAN M1.4）：PATCH /api/issues/[id]
 * body: { status, fixedInVersion?, note? }
 * 置 fixed 时必须填 fixedInVersion —— 「新版本有没有修好」需要版本锚点才能验证。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | { status?: string; fixedInVersion?: string }
    | null;

  if (!body?.status || !ALLOWED_STATUS.has(body.status)) {
    return NextResponse.json(
      { error: `status must be one of: ${[...ALLOWED_STATUS].join(", ")}` },
      { status: 400 },
    );
  }

  const fixedInVersion = (body.fixedInVersion ?? "").trim();
  if (body.status === "fixed" && !fixedInVersion) {
    return NextResponse.json({ error: "标记 fixed 必须填写 fixedInVersion" }, { status: 400 });
  }

  const existing = await prisma.issue.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Issue not found" }, { status: 404 });

  const issue = await prisma.issue.update({
    where: { id },
    data: {
      status: body.status,
      // 只在置 fixed 时写入版本；转回 open 保留旧值（复发判定需要）
      ...(body.status === "fixed" ? { fixedInVersion } : {}),
    },
  });

  return NextResponse.json({
    id: issue.id,
    status: issue.status,
    fixedInVersion: issue.fixedInVersion,
  });
}
