import { PrismaClient } from "@prisma/client";
import { runEvaluator } from "./evaluators";
import { assembleContext } from "./judge-assembly";

const prisma = new PrismaClient();

class Semaphore {
  private permits: number;
  private queue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

export interface RunOptions {
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

export async function runExperiment(
  experimentId: string,
  options?: RunOptions
): Promise<void> {
  const concurrency = options?.concurrency ?? 4;
  const semaphore = new Semaphore(concurrency);

  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: {
      cases: {
        include: { results: true },
      },
    },
  });

  if (!experiment) {
    throw new Error("Experiment not found");
  }

  await prisma.experiment.update({
    where: { id: experimentId },
    data: { status: "running" },
  });

  const pendingResults = experiment.cases.flatMap((c) =>
    c.results.filter((r) => r.status === "pending" || r.status === "failed")
  );

  // 实验级规则评估器配置：Record<evaluatorId, params>
  let configMap: Record<string, Record<string, unknown>> = {};
  try {
    const parsed = JSON.parse(experiment.evaluatorConfigJson || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      configMap = parsed;
    }
  } catch {
    console.error("Invalid evaluatorConfigJson for experiment:", experimentId);
  }

  const total = pendingResults.length;
  let done = 0;

  const tasks = pendingResults.map(async (result) => {
    await semaphore.acquire();
    try {
      const caseData = experiment.cases.find((c) => c.id === result.caseId);
      if (!caseData) return;

      await prisma.experimentEvalResult.update({
        where: { id: result.id },
        data: { status: "running" },
      });

      const context = await assembleContext(
        caseData.sessionId,
        caseData.input,
        caseData.actualOutput,
        caseData.referenceOutput
      );

      const startTime = Date.now();
      const output = await runEvaluator(result.evaluatorId, context, configMap[result.evaluatorId]);
      const durationMs = Date.now() - startTime;

      await prisma.experimentEvalResult.update({
        where: { id: result.id },
        data: {
          status: "done",
          score: output.score,
          verdict: output.verdict,
          summary: output.summary,
          evidenceJson: JSON.stringify(output.evidence),
          durationMs,
          attempts: { increment: 1 },
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.experimentEvalResult.update({
        where: { id: result.id },
        data: {
          status: "failed",
          errorMessage: message,
          attempts: { increment: 1 },
        },
      });
    } finally {
      done++;
      options?.onProgress?.(done, total);
      semaphore.release();
    }
  });

  await Promise.all(tasks);

  await prisma.experiment.update({
    where: { id: experimentId },
    data: { status: "done" },
  });
}
