import type { EmbeddingSpace } from '@/lib/llm/embedding-space';

export interface SemanticVectorRow {
  target_key: string;
  content_hash: string;
  embedding: string | null;
  embedding_model: string | null;
  dims: number;
  updated_at: string;
}

export function matchingIndexRows(
  stored: SemanticVectorRow[],
  expectedHashes: Map<string, string>,
  space: EmbeddingSpace
): SemanticVectorRow[] {
  return stored.filter(
    (row) =>
      row.embedding !== null &&
      expectedHashes.get(row.target_key) === row.content_hash &&
      row.embedding_model === space.id &&
      row.dims === space.dimensions
  );
}

/** Do not add coverage from different spaces, even if dimensions match. */
export function bestCompatibleIndex(
  stored: SemanticVectorRow[],
  expectedHashes: Map<string, string>,
  spaces: EmbeddingSpace[]
): { space: EmbeddingSpace | null; rows: SemanticVectorRow[] } {
  let best: { space: EmbeddingSpace | null; rows: SemanticVectorRow[] } = { space: null, rows: [] };
  for (const space of spaces) {
    const rows = matchingIndexRows(stored, expectedHashes, space);
    if (rows.length > best.rows.length) best = { space, rows };
  }
  return best;
}
