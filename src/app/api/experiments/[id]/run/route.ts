import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { runExperiment } from "@/lib/engine/experiment/run-experiment";

const prisma = new PrismaClient();

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const experiment = await prisma.experiment.findUnique({
    where: { id },
    include: { cases: { include: { results: true } } },
  });

  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  if (experiment.status === "running") {
    return NextResponse.json({ error: "Experiment already running" }, { status: 400 });
  }

  const evaluatorIds = JSON.parse(experiment.evaluatorIdsJson) as string[];

  for (const expCase of experiment.cases) {
    for (const evaluatorId of evaluatorIds) {
      const existing = expCase.results.find(
        (r) => r.evaluatorId === evaluatorId && r.status !== "failed"
      );
      if (!existing) {
        await prisma.experimentEvalResult.create({
          data: {
            experimentId: id,
            caseId: expCase.id,
            evaluatorId,
            status: "pending",
          },
        });
      }
    }
  }

  runExperiment(id).catch(async (err) => {
    console.error("Experiment run failed:", err);
    await prisma.experiment.update({
      where: { id },
      data: { status: "failed" },
    });
  });

  return NextResponse.json({ ok: true, message: "Experiment started" });
}
