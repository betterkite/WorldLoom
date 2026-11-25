import { describe, expect, it } from 'vitest';
import { isValidEvalScore, summarizeAnswerResults } from '@/lib/evals/score';

describe('answer evaluation score semantics', () => {
  it('accepts real zero and one, rejecting invalid or unavailable values', () => {
    expect(isValidEvalScore(0)).toBe(true);
    expect(isValidEvalScore(1)).toBe(true);
    for (const value of [-1, 2, Infinity, NaN, null, undefined, '0.8'])
      expect(isValidEvalScore(value)).toBe(false);
  });

  it('keeps an unavailable aggregate distinct from a legitimate zero', () => {
    expect(summarizeAnswerResults([{ score: null }, { score: null, skipped: true }])).toEqual({
      score: null,
      scoredCount: 0,
      totalCount: 2
    });
    expect(summarizeAnswerResults([{ score: 0 }])).toEqual({
      score: 0,
      scoredCount: 1,
      totalCount: 1
    });
  });

  it('averages only valid completed rows and preserves the original results', () => {
    const rows = [
      { score: 0 },
      { score: 1 },
      { score: 0.5 },
      { score: 2 },
      { score: 1, skipped: true },
      { score: null }
    ];
    const before = structuredClone(rows);
    expect(summarizeAnswerResults(rows)).toEqual({ score: 0.5, scoredCount: 3, totalCount: 6 });
    expect(rows).toEqual(before);
  });

  it('does not fabricate a result from malformed historical rows', () => {
    expect(summarizeAnswerResults(null)).toEqual({ score: null, scoredCount: 0, totalCount: 0 });
    expect(summarizeAnswerResults([null, 'wrong', {}, { score: '0' }])).toEqual({
      score: null,
      scoredCount: 0,
      totalCount: 4
    });
  });
});
