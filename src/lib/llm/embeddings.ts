import {
  getCredential,
  getEmbeddingsConfig,
  getLocalEmbeddingsConfig,
  isLocalEmbeddingAvailable
} from './config';
import { localEmbeddingSpace, remoteEmbeddingSpace, type EmbeddingSpace } from './embedding-space';
import { embedLocally, localEmbeddingSummary, LocalEmbeddingError } from './local-embeddings';
import {
  discardProviderResponse,
  EMBEDDING_RESPONSE_MAX_BYTES,
  ProviderResponseError,
  readProviderJson
} from './response-body';

/**
 * Semantic embeddings (Phase 4, optional).
 * Calls an OpenAI-compatible POST {baseUrl}/embeddings. When unconfigured or
 * failing, try the local model for the whole input; typed failure lets retrieval
 * degrade to lexical. Do not mix successful remote batches with local vectors.
 */

const EMBEDDING_TIMEOUT_MS = 30_000;

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

function parseVectorBatch(payload: unknown, count: number, dimensions: number): number[][] {
  const invalid = () =>
    new EmbeddingError('embedding_invalid_response', 'Embeddings returned an invalid vector batch');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid();
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length !== count) throw invalid();
  const vectors: number[][] = [];
  const seen = new Set<number>();
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalid();
    const { index, embedding } = item as { index?: unknown; embedding?: unknown };
    if (
      typeof index !== 'number' ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= count ||
      seen.has(index) ||
      !Array.isArray(embedding) ||
      embedding.length !== dimensions ||
      embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    ) {
      throw invalid();
    }
    seen.add(index);
    vectors[index] = embedding;
  }
  return vectors;
}

export async function embed(
  texts: string[],
  options: { localEmbedFn?: (texts: string[]) => Promise<number[][]> } = {}
): Promise<number[][]> {
  return (await embedWithSpace(texts, options)).vectors;
}

export interface EmbeddingBatch {
  vectors: number[][];
  space: EmbeddingSpace;
}

/** Preserve the backend actually used, including whole-input local fallback. */
export async function embedWithSpace(
  texts: string[],
  options: { localEmbedFn?: (texts: string[]) => Promise<number[][]> } = {}
): Promise<EmbeddingBatch> {
  const cfg = getEmbeddingsConfig();
  const localFallback = async (remoteError?: EmbeddingError) => {
    try {
      const local = getLocalEmbeddingsConfig();
      if (!local?.enabled) throw new LocalEmbeddingError();
      const vectors = await (options.localEmbedFn ?? embedLocally)(texts);
      return { vectors, space: localEmbeddingSpace(local) };
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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);
      let response: Response | undefined;
      try {
        try {
          response = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/embeddings`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: cfg.model, input: batch }),
            signal: controller.signal
          });
        } catch {
          throw new EmbeddingError('embedding_upstream_error', 'Embeddings request failed');
        }
        if (!response.ok) {
          // No error-body read: HTTP 402 must reach local fallback even when
          // its body or cancellation never settles. Never expose raw details.
          throw new EmbeddingError(
            'embedding_upstream_error',
            `Embeddings returned HTTP ${response.status}`,
            { status: response.status }
          );
        }
        let payload: unknown;
        try {
          payload = await readProviderJson(
            response,
            controller.signal,
            EMBEDDING_RESPONSE_MAX_BYTES
          );
        } catch (error) {
          const code = controller.signal.aborted
            ? 'embedding_timeout'
            : error instanceof ProviderResponseError && error.code === 'too_large'
              ? 'embedding_response_too_large'
              : 'embedding_invalid_response';
          throw new EmbeddingError(code, 'Embeddings response could not be read safely');
        }
        vectors.push(...parseVectorBatch(payload, batch.length, cfg.dimensions));
      } catch (error) {
        if (response) discardProviderResponse(controller, response);
        else controller.abort();
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    return { vectors, space: remoteEmbeddingSpace(cfg) };
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
