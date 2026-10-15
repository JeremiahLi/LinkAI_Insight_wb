export interface EvalResultRow {
  evaluatorId: string;
  status: string;
  score: number | null;
  humanScore: number | null;
}

export interface EvaluatorScore {
  evaluatorId: string;
  averageScore: number | null;
  scoredCount: number;
}

export interface ScoreAggregation {
  overallAverage: number | null;
  evaluatorScores: EvaluatorScore[];
  totalCases: number;
  scoredCases: number;
}

function effectiveScore(row: EvalResultRow): number | null {
  if (row.status !== "done") return null;
  return row.humanScore ?? row.score ?? null;
}

export function aggregateScores(
  results: EvalResultRow[],
  evaluatorIds: string[]
): ScoreAggregation {
  const scoredRows = results.filter((r) => effectiveScore(r) !== null);
  const overallAverage =
    scoredRows.length > 0
      ? scoredRows.reduce((sum, r) => sum + effectiveScore(r)!, 0) / scoredRows.length
      : null;

  const evaluatorScores: EvaluatorScore[] = evaluatorIds.map((evaluatorId) => {
    const rows = results.filter(
      (r) => r.evaluatorId === evaluatorId && effectiveScore(r) !== null
    );
    const avg =
      rows.length > 0
        ? rows.reduce((sum, r) => sum + effectiveScore(r)!, 0) / rows.length
        : null;
    return { evaluatorId, averageScore: avg, scoredCount: rows.length };
  });

  const cases = new Set(results.map((r) => r.evaluatorId));
  const scoredCases = Array.from(cases).filter((evaluatorId) =>
    results.some((r) => r.evaluatorId === evaluatorId && effectiveScore(r) !== null)
  ).length;

  return {
    overallAverage,
    evaluatorScores,
    totalCases: results.length,
    scoredCases,
  };
}
