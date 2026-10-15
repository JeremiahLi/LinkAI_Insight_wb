import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { aggregateScores } from "@/lib/engine/experiment/detail-agg";

const prisma = new PrismaClient();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const experiment = await prisma.experiment.findUnique({
    where: { id },
    include: {
      cases: {
        include: {
          results: true,
        },
        orderBy: { createdAt: "asc" },
      },
      comments: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  const evaluatorIds = JSON.parse(experiment.evaluatorIdsJson) as string[];

  const allResults = experiment.cases.flatMap((c) =>
    c.results.map((r) => ({
      evaluatorId: r.evaluatorId,
      status: r.status,
      score: r.score,
      humanScore: r.humanScore,
    }))
  );
  const aggregation = aggregateScores(allResults, evaluatorIds);

  return NextResponse.json({
    id: experiment.id,
    name: experiment.name,
    type: experiment.type,
    agentId: experiment.agentId,
    evaluatorIds,
    status: experiment.status,
    scope: experiment.scope,
    watchMode: experiment.watchMode,
    overallAverage: aggregation.overallAverage,
    evaluatorScores: aggregation.evaluatorScores,
    cases: experiment.cases.map((c) => ({
      id: c.id,
      sessionId: c.sessionId,
      input: c.input,
      actualOutput: c.actualOutput,
      referenceOutput: c.referenceOutput,
      results: c.results.map((r) => ({
        id: r.id,
        evaluatorId: r.evaluatorId,
        status: r.status,
        verdict: r.verdict,
        summary: r.summary,
        score: r.score,
        humanScore: r.humanScore,
        errorMessage: r.errorMessage,
      })),
    })),
    comments: experiment.comments,
    createdAt: experiment.createdAt,
    updatedAt: experiment.updatedAt,
  });
}
