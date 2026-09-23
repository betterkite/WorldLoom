import { resolve } from 'node:path';
import { getLocalEmbeddingsConfig, isLocalEmbeddingAvailable } from './config';

export class LocalEmbeddingError extends Error {
  readonly code = 'embedding_local_unavailable';

  constructor() {
    super('Local embedding model is unavailable');
    this.name = 'LocalEmbeddingError';
  }
}

type FeatureExtractor = (
  texts: string[],
  options: { pooling: 'cls'; normalize: true }
) => Promise<{
  tolist?: () => unknown;
}>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

async function loadExtractor(): Promise<FeatureExtractor> {
  const config = getLocalEmbeddingsConfig();
  if (!config?.enabled) throw new LocalEmbeddingError();

  const { env, LogLevel, pipeline } = await import('@huggingface/transformers');
  env.logLevel = LogLevel.ERROR;
  const cacheDir = resolve(/* turbopackIgnore: true */ process.cwd(), config.cacheDir);
  const modelPath = resolve(/* turbopackIgnore: true */ cacheDir, config.model);
  return (await pipeline('feature-extraction', modelPath, {
    dtype: config.dtype,
    cache_dir: cacheDir,
    local_files_only: true
  })) as unknown as FeatureExtractor;
}

export async function embedLocally(texts: string[]): Promise<number[][]> {
  const config = getLocalEmbeddingsConfig();
  if (!config?.enabled || texts.length === 0) throw new LocalEmbeddingError();
  extractorPromise ??= loadExtractor();

  try {
    const output = await (await extractorPromise)(texts, { pooling: 'cls', normalize: true });
    const vectors = output.tolist?.();
    if (!Array.isArray(vectors) || vectors.length !== texts.length) throw new LocalEmbeddingError();
    const normalized = vectors.map((vector) => {
      if (!Array.isArray(vector) || vector.length !== config.dimensions) {
        throw new LocalEmbeddingError();
      }
      return vector.map((value) => Number(value));
    });
    if (normalized.some((vector) => vector.some((value) => !Number.isFinite(value)))) {
      throw new LocalEmbeddingError();
    }
    return normalized;
  } catch (error) {
    extractorPromise = null;
    if (error instanceof LocalEmbeddingError) throw error;
    throw new LocalEmbeddingError();
  }
}

export function localEmbeddingSummary() {
  const config = getLocalEmbeddingsConfig();
  return config
    ? {
        enabled: config.enabled,
        available: isLocalEmbeddingAvailable(),
        model: config.model,
        dimensions: config.dimensions,
        cached: extractorPromise !== null
      }
    : null;
}
