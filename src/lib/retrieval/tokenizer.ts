import { createHash } from 'node:crypto';

/**
 * CJK bigram tokenizer used by WorldLoom lexical retrieval.
 * Latin words kept whole (≥2 chars); CJK runs become overlapping bigrams —
 * a deterministic offline matching scheme.
 */
export function tokenize(text: string): string[] {
  const normalized = String(text ?? '').toLowerCase();
  const words = normalized.match(/[a-z0-9_]{2,}/g) ?? [];
  const cjk: string[] = [];
  for (const run of normalized.match(/[\u3400-\u9fff]+/g) ?? []) {
    if (run.length === 1) cjk.push(run);
    for (let i = 0; i < run.length - 1; i += 1) cjk.push(run.slice(i, i + 2));
  }
  return [...words, ...cjk];
}

/** Cosine over equal-length vectors (0 for mismatched/empty). */
export function cosine(left: number[], right: number[]): number {
  if (!left?.length || left.length !== right?.length) return 0;
  let dot = 0;
  let normLeft = 0;
  let normRight = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    normLeft += left[i] * left[i];
    normRight += right[i] * right[i];
  }
  if (normLeft === 0 || normRight === 0) return 0;
  return dot / (Math.sqrt(normLeft) * Math.sqrt(normRight));
}

/** Stable content hash for re-embedding decisions. */
export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
