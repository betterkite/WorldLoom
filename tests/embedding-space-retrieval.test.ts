import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  remote: {
    enabled: true,
    model: 'remote-model',
    dimensions: 64,
    baseUrl: 'https://remote.invalid/v1'
  },
  local: { enabled: true, model: 'local-model', dimensions: 64, dtype: 'int8' },
  vectors: vi.fn(),
  world: { findUnique: vi.fn() },
  entity: { findMany: vi.fn() },
  chronicleEvent: { findMany: vi.fn() },
  relationshipEvent: { findMany: vi.fn() },
  eventEdge: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn()
}));
vi.mock('@/lib/db/client', () => ({ prisma: state }));
vi.mock('@/lib/llm/config', () => ({
  getEmbeddingsConfig: () => state.remote,
  getLocalEmbeddingsConfig: () => state.local,
  isSemanticEnabled: () => true
}));
vi.mock('@/lib/llm/embeddings', () => {
  class EmbeddingError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { embed: vi.fn(), embedWithSpace: state.vectors, EmbeddingError };
});

import { EmbeddingError } from '@/lib/llm/embeddings';
import { localEmbeddingSpace, remoteEmbeddingSpace } from '@/lib/llm/embedding-space';
import { contentHash } from '@/lib/retrieval/tokenizer';
import { getSemanticIndexStatus, indexWorldSemantic, searchWorld } from '@/lib/retrieval/search';
import type { SemanticVectorRow } from '@/lib/retrieval/embedding-index';

const vector = () => [1, ...Array.from({ length: 63 }, () => 0)];
const entity = (uid = 'lamp') => ({
  uid,
  name: '港口守灯人',
  kind: 'character',
  summary: '记录港口潮汐',
  content: '巡视灯塔'
});
let stored: SemanticVectorRow[];
function row(spaceId: string, uid = 'lamp'): SemanticVectorRow {
  const e = entity(uid);
  return {
    target_key: `entity:${uid}`,
    content_hash: contentHash(`${e.name}\n${e.summary}\n${e.content}`),
    embedding: JSON.stringify(vector()),
    embedding_model: spaceId,
    dims: 64,
    updated_at: '2026-10-26'
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.local.model = 'local-model';
  state.local.dtype = 'int8';
  state.local.dimensions = 64;
  stored = [];
  state.world.findUnique.mockResolvedValue({ id: 'own-fixture', masterVersion: 1 });
  state.entity.findMany.mockResolvedValue([entity()]);
  state.chronicleEvent.findMany.mockResolvedValue([]);
  state.relationshipEvent.findMany.mockResolvedValue([]);
  state.eventEdge.findMany.mockResolvedValue([]);
  state.$queryRaw.mockImplementation(async () => stored);
  state.$executeRaw.mockResolvedValue(1);
  state.vectors.mockResolvedValue({
    vectors: [vector()],
    space: remoteEmbeddingSpace(state.remote)
  });
});

describe('actual embedding space is retained through indexing and retrieval (mock IO)', () => {
  it('persists the actual local identity after provider fallback', async () => {
    const local = localEmbeddingSpace(state.local);
    state.vectors.mockResolvedValue({ vectors: [vector()], space: local });
    await expect(indexWorldSemantic('own-fixture')).resolves.toMatchObject({
      indexed: 1,
      skipped: false
    });
    expect(state.$executeRaw.mock.calls[0].at(-1)).toBe(local.id);
    expect(state.$executeRaw.mock.calls[0].at(-1)).not.toBe(state.remote.model);
  });

  it('does not label a query hybrid when local index and remote query spaces differ', async () => {
    stored = [row(localEmbeddingSpace(state.local).id)];
    const result = await searchWorld('own-fixture', '港口守灯人');
    expect(result).toMatchObject({
      mode: 'lexical',
      semantic: { fresh: false, reason: 'embedding_space_mismatch', indexed: 0 }
    });
    expect(result.hits[0].denseScore).toBe(0);
    expect(result.hits[0].lexicalScore).toBeGreaterThan(0);
  });

  it.each(['remote', 'local'])(
    'uses dense scores when query and %s index share one space',
    async (backend) => {
      const space =
        backend === 'local' ? localEmbeddingSpace(state.local) : remoteEmbeddingSpace(state.remote);
      stored = [row(space.id)];
      state.vectors.mockResolvedValue({ vectors: [vector()], space });
      const result = await searchWorld('own-fixture', '港口守灯人');
      expect(result.mode).toBe('hybrid');
      expect(result.semantic).toMatchObject({
        fresh: true,
        embeddingSpaceId: space.id,
        embeddingModel: space.model
      });
      expect(result.hits[0].denseScore).toBe(1);
    }
  );

  it.each(['model', 'dtype', 'dimensions'] as const)(
    'marks old local vectors stale after changing %s',
    async (field) => {
      stored = [row(localEmbeddingSpace(state.local).id)];
      if (field === 'dimensions') state.local.dimensions = 128;
      else state.local[field] = 'changed';
      expect(await getSemanticIndexStatus('own-fixture')).toMatchObject({
        indexed: 0,
        fresh: false,
        reason: 'stale_index'
      });
      expect((await searchWorld('own-fixture', '港口')).mode).toBe('lexical');
      expect(state.vectors).not.toHaveBeenCalled();
    }
  );

  it('treats a legacy model-only label as unverified without automatic embedding', async () => {
    stored = [row(state.remote.model)];
    const result = await searchWorld('own-fixture', '港口');
    expect(result.mode).toBe('lexical');
    expect(result.semantic).toMatchObject({ fresh: false, reason: 'stale_index' });
    expect(state.vectors).not.toHaveBeenCalled();
  });

  it('does not combine two incompatible half-indexes to claim full coverage', async () => {
    state.entity.findMany.mockResolvedValue([entity(), entity('other')]);
    stored = [
      row(localEmbeddingSpace(state.local).id),
      row(remoteEmbeddingSpace(state.remote).id, 'other')
    ];
    const result = await searchWorld('own-fixture', '港口');
    expect(result).toMatchObject({
      mode: 'lexical',
      semantic: { coverage: 0.5, fresh: false, indexed: 1 }
    });
    expect(state.vectors).not.toHaveBeenCalled();
  });

  it('rejects matching labels with incompatible actual vector dimensions', async () => {
    stored = [{ ...row(remoteEmbeddingSpace(state.remote).id), dims: 128 }];
    expect((await getSemanticIndexStatus('own-fixture')).fresh).toBe(false);
    expect(state.vectors).not.toHaveBeenCalled();
  });

  it('still falls back to lexical if both embedding backends fail', async () => {
    stored = [row(localEmbeddingSpace(state.local).id)];
    state.vectors.mockRejectedValue(
      new EmbeddingError('embedding_local_unavailable', 'Unavailable')
    );
    expect(await searchWorld('own-fixture', '港口')).toMatchObject({
      mode: 'lexical',
      semantic: { reason: 'embedding_error', fresh: false }
    });
  });

  it('keeps endpoint credentials out of persisted identity and distinguishes providers', () => {
    const a = remoteEmbeddingSpace({
      ...state.remote,
      baseUrl: 'https://user:private@remote.invalid/v1/?key=secret'
    });
    const b = remoteEmbeddingSpace(state.remote);
    expect(a.id).toBe(b.id);
    expect(a.id).not.toMatch(/private|secret|remote\.invalid/);
    expect(
      remoteEmbeddingSpace({ ...state.remote, baseUrl: 'https://other.invalid/v1' }).id
    ).not.toBe(b.id);
  });
});
