import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ resultId: string }> }
) {
  const { resultId } = await params;

  const existing = await prisma.experimentEvalResult.findUnique({
    where: { id: resultId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Result not found" }, { status: 404 });
  }

  const result = await prisma.experimentEvalResult.update({
    where: { id: resultId },
    data: {
      status: "pending",
      errorMessage: null,
      attempts: { increment: 1 },
    },
  });

  return NextResponse.json(result);
}
