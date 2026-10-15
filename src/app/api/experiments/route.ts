import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET() {
  const experiments = await prisma.experiment.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { cases: true } },
    },
  });

  const result = experiments.map((exp) => ({
    id: exp.id,
    name: exp.name,
    type: exp.type,
    agentId: exp.agentId,
    evaluatorIds: JSON.parse(exp.evaluatorIdsJson) as string[],
    status: exp.status,
    scope: exp.scope,
    watchMode: exp.watchMode,
    caseCount: exp._count.cases,
    createdAt: exp.createdAt,
    updatedAt: exp.updatedAt,
  }));

  return NextResponse.json(result);
}

async function extractSessionData(sessionId: string): Promise<{ input: string; actualOutput: string }> {
  if (!sessionId) return { input: "", actualOutput: "" };

  const spans = await prisma.span.findMany({
    where: { sessionId },
    orderBy: [{ roundIndex: "asc" }, { turnId: "asc" }],
  });

  let input = "";
  let actualOutput = "";

  for (const span of spans) {
    if (span.kind === "user" && span.input && !input) {
      input = span.input;
    }
    if (span.kind === "answer" && span.output && !actualOutput) {
      actualOutput = span.output;
    }
  }

  return { input, actualOutput };
}

export async function POST(request: Request) {
  const body = await request.json();
  const { name, type, agentId, evaluatorIds, cases, caseIds, scope } = body;

  if (!name || !agentId || !evaluatorIds) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const caseItems = cases || (caseIds?.map((id: string) => ({ sessionId: id })) ?? []);

  if (caseItems.length === 0) {
    return NextResponse.json({ error: "At least one case is required" }, { status: 400 });
  }

  const casesWithData = await Promise.all(
    caseItems.map(async (item: { sessionId?: string; referenceOutput?: string | null }) => {
      const { input, actualOutput } = await extractSessionData(item.sessionId || "");
      return {
        sessionId: item.sessionId || null,
        input,
        actualOutput,
        referenceOutput: item.referenceOutput || null,
      };
    })
  );

  const experiment = await prisma.experiment.create({
    data: {
      userId: "default",
      name,
      type: type || "single",
      agentId,
      evaluatorIdsJson: JSON.stringify(evaluatorIds),
      scope: scope || "",
      status: "draft",
      cases: {
        create: casesWithData,
      },
    },
    include: {
      cases: true,
    },
  });

  return NextResponse.json({
    id: experiment.id,
    name: experiment.name,
    status: experiment.status,
    caseCount: experiment.cases.length,
  });
}
