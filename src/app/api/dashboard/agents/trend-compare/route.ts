import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { resolveRange } from "@/lib/engine/stats/range";
import { getAgentsTrendCompare, type TrendGranularity } from "@/lib/engine/stats/trend";

const prisma = new PrismaClient();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = resolveRange(searchParams.get("range"));
  const granularity: TrendGranularity = searchParams.get("granularity") === "week" ? "week" : "day";
  const topNParam = Number(searchParams.get("topN"));
  const topN = Number.isFinite(topNParam) && topNParam > 0 ? topNParam : 8;

  const compare = await getAgentsTrendCompare(prisma, range.startMs, granularity, topN);
  return NextResponse.json({ range: range.label, granularity, ...compare });
}
