import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { resolveRange } from "@/lib/engine/stats/range";
import { getUserCompare } from "@/lib/engine/stats/user-compare";

const prisma = new PrismaClient();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = resolveRange(searchParams.get("range"));

  const users = await getUserCompare(prisma, range.startMs);
  return NextResponse.json({ range: range.label, users });
}
