/** Shared by persistence and presentation, including legacy answer-run results. */
export function isValidEvalScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function summarizeAnswerResults(results: unknown) {
  const rows: unknown[] = Array.isArray(results) ? results : [];
  const scores = rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const value = row as { score?: unknown; skipped?: unknown };
    return value.skipped !== true && isValidEvalScore(value.score) ? [value.score] : [];
  });
  return {
    score: scores.length
      ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(4))
      : null,
    scoredCount: scores.length,
    totalCount: rows.length
  };
}
