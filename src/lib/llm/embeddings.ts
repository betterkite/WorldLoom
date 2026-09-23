import { getCredential, getEmbeddingsConfig, isLocalEmbeddingAvailable } from './config';
import { embedLocally, localEmbeddingSummary, LocalEmbeddingError } from './local-embeddings';

/**
 * Semantic embeddings (Phase 4, optional).
 * Calls an OpenAI-compatible POST {baseUrl}/embeddings. When unconfigured or
 * failing, retrieval degrades to pure lexical — never crashes the product.
 */

export class EmbeddingError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, message: string, options?: { status?: number }) {
    super(message);
    this.name = 'EmbeddingError';
    this.code = code;
    this.status = options?.status;
  }
}

export async function embed(
  texts: string[],
  options: { localEmbedFn?: (texts: string[]) => Promise<number[][]> } = {}
): Promise<number[][]> {
  const cfg = getEmbeddingsConfig();
  const localFallback = async (remoteError?: EmbeddingError) => {
    try {
      return await (options.localEmbedFn ?? embedLocally)(texts);
    } catch (error) {
      if (error instanceof LocalEmbeddingError) {
        throw new EmbeddingError(
          error.code,
          'Remote and local embedding providers are unavailable',
          { status: remoteError?.status }
        );
      }
      throw error;
    }
  };

  if (!cfg?.enabled) return localFallback();
  const key = process.env[cfg.credentialEnv]?.trim();
  if (!key)
    return localFallback(
      new EmbeddingError(
        'embedding_credential_missing',
        'Remote embedding credential is not configured'
      )
    );

  const vectors: number[][] = [];
  try {
    for (let offset = 0; offset < texts.length; offset += cfg.batchSize) {
      const batch = texts.slice(offset, offset + cfg.batchSize);
      let response: Response;
      try {
        response = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/embeddings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({ model: cfg.model, input: batch }),
          signal: AbortSignal.timeout(30_000)
        });
      } catch {
        throw new EmbeddingError('embedding_upstream_error', 'Embeddings request failed');
      }
      if (!response.ok) {
        await response.text().catch(() => '');
        throw new EmbeddingError(
          'embedding_upstream_error',
          `Embeddings returned HTTP ${response.status}`,
          { status: response.status }
        );
      }
      let payload: { data?: { index: number; embedding: number[] }[] };
      try {
        payload = (await response.json()) as { data?: { index: number; embedding: number[] }[] };
      } catch {
        throw new EmbeddingError('embedding_invalid_response', 'Embeddings returned invalid JSON');
      }
      const batchVectors = (payload.data ?? [])
        .toSorted((a, b) => a.index - b.index)
        .map((item) => item.embedding);
      if (batchVectors.length !== batch.length || batchVectors.some((v) => !Array.isArray(v))) {
        throw new EmbeddingError(
          'embedding_invalid_response',
          'Embeddings returned an invalid vector batch'
        );
      }
      vectors.push(...batchVectors);
    }
    return vectors;
  } catch (error) {
    if (error instanceof EmbeddingError) return localFallback(error);
    throw error;
  }
}

export function embeddingConfigSummary() {
  const cfg = getEmbeddingsConfig();
  if (!cfg) return null;
  return {
    enabled: cfg.enabled,
    model: cfg.model,
    dimensions: cfg.dimensions,
    configured: Boolean(process.env[cfg.credentialEnv]?.trim()) || isLocalEmbeddingAvailable(),
    remoteConfigured: Boolean(process.env[cfg.credentialEnv]?.trim()),
    local: localEmbeddingSummary()
  };
}

export { getCredential };
