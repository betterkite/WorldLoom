import { createHash } from 'node:crypto';
import { getEmbeddingsConfig, getLocalEmbeddingsConfig } from './config';

export interface EmbeddingSpace {
  id: string;
  backend: 'remote' | 'local';
  model: string;
  dimensions: number;
  dtype?: string;
}

function identify(description: Omit<EmbeddingSpace, 'id'>, endpoint?: string): EmbeddingSpace {
  // Credentials and cache paths are not part of the persisted identifier.
  const hash = createHash('sha256')
    .update(JSON.stringify({ ...description, endpoint }))
    .digest('hex');
  return { ...description, id: `worldloom-embedding-v1:${hash}` };
}

export function remoteEmbeddingSpace(config: {
  model: string;
  dimensions: number;
  baseUrl: string;
}): EmbeddingSpace {
  const url = new URL(config.baseUrl);
  return identify(
    { backend: 'remote', model: config.model, dimensions: config.dimensions },
    `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  );
}

export function localEmbeddingSpace(config: {
  model: string;
  dimensions: number;
  dtype: string;
}): EmbeddingSpace {
  return identify({
    backend: 'local',
    model: config.model,
    dimensions: config.dimensions,
    dtype: config.dtype
  });
}

/** Configured spaces describe index compatibility, not provider availability. */
export function configuredEmbeddingSpaces(): EmbeddingSpace[] {
  const remote = getEmbeddingsConfig();
  const local = getLocalEmbeddingsConfig();
  return [
    ...(remote?.enabled ? [remoteEmbeddingSpace(remote)] : []),
    ...(local?.enabled ? [localEmbeddingSpace(local)] : [])
  ];
}
