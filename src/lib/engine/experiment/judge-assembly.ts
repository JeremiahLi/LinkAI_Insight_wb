import { PrismaClient } from "@prisma/client";
import type { EvaluatorContext, ToolCall } from "./evaluators";

const prisma = new PrismaClient();

export async function assembleContext(
  sessionId: string | null,
  inputFallback: string,
  actualOutputFallback: string,
  referenceOutput: string | null
): Promise<EvaluatorContext> {
  if (!sessionId) {
    return {
      input: inputFallback,
      actualOutput: actualOutputFallback,
      referenceOutput: referenceOutput || undefined,
      trace: [],
    };
  }

  const spans = await prisma.span.findMany({
    where: { sessionId },
    orderBy: [{ roundIndex: "asc" }, { turnId: "asc" }],
  });

  let input = inputFallback;
  let actualOutput = actualOutputFallback;
  const trace: ToolCall[] = [];

  for (const span of spans) {
    if (span.kind === "user" && span.input && inputFallback === "") {
      input = span.input;
    }
    if (span.kind === "answer" && span.output && actualOutputFallback === "") {
      actualOutput = span.output;
    }
    if (span.kind === "tool_call") {
      trace.push({
        name: span.name || "unknown",
        input: span.input || "",
        output: span.output || "",
        error: span.error || undefined,
      });
    }
  }

  return {
    input: input || inputFallback,
    actualOutput: actualOutput || actualOutputFallback,
    referenceOutput: referenceOutput || undefined,
    trace,
  };
}
