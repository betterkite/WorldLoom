import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/client';

const fixture = vi.hoisted(() => ({
  embed: vi.fn(),
  local: { enabled: true, model: 'synthetic-local', dimensions: 2, dtype: 'int8' },
  remote: {
    enabled: true,
    model: 'synthetic-remote',
    dimensions: 2,
    baseUrl: 'https://synthetic.invalid/v1',
    credentialEnv: 'WORLDLOOM_TEST_EMBEDDING',
    batchSize: 2
  }
}));
vi.mock('@/lib/llm/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/llm/config')>()),
  getEmbeddingsConfig: () => fixture.remote,
  getLocalEmbeddingsConfig: () => fixture.local,
  isSemanticEnabled: () => true
}));
vi.mock('@/lib/llm/embeddings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/llm/embeddings')>()),
  embedWithSpace: fixture.embed
}));

import { localEmbeddingSpace, remoteEmbeddingSpace } from '@/lib/llm/embedding-space';
import { EmbeddingError } from '@/lib/llm/embeddings';
import { getSemanticIndexStatus, indexWorldSemantic, searchWorld } from '@/lib/retrieval/search';
import { GET } from '@/app/api/worlds/[worldId]/semantic-index/route';

let worldId: string;
beforeEach(async () => {
  fixture.local = { enabled: true, model: 'synthetic-local', dimensions: 2, dtype: 'int8' };
  fixture.embed.mockReset().mockImplementation(async (texts: string[]) => ({
    vectors: texts.map(() => [1, 0]),
    space: localEmbeddingSpace(fixture.local)
  }));
  const world = await prisma.world.create({ data: { name: `Embedding SQL ${randomUUID()}` } });
  worldId = world.id;
  await prisma.entity.create({
    data: {
      worldId,
      version: 1,
      uid: `ent_${randomUUID()}`,
      kind: 'character',
      name: '守灯人',
      summary: '合成向量验收',
      content: '只连接临时测试库'
    }
  });
});
afterEach(async () => {
  await prisma.world.deleteMany({ where: { id: worldId } });
});

describe('embedding space persistence (real PostgreSQL, synthetic vectors)', () => {
  it('persists the actual space and uses matching rows for hybrid retrieval', async () => {
    await indexWorldSemantic(worldId);
    const rows = await prisma.$queryRaw<{ space: string; dims: number }[]>`
      SELECT "embeddingModel" AS space, vector_dims(embedding) AS dims
      FROM semantic_vectors WHERE "worldId" = ${worldId}
    `;
    expect(rows).toEqual([{ space: localEmbeddingSpace(fixture.local).id, dims: 2 }]);
    expect(await getSemanticIndexStatus(worldId)).toMatchObject({
      fresh: true,
      indexed: 1,
      embeddingSpaceId: rows[0].space
    });
    const result = await searchWorld(worldId, '守灯人', { useSemantic: true });
    expect(result.mode).toBe('hybrid');
    expect(result.hits[0].denseScore).toBeGreaterThan(0);
  });

  it('does not compare a remote query to a same-dimension local index', async () => {
    await indexWorldSemantic(worldId);
    fixture.embed.mockResolvedValue({
      vectors: [[1, 0]],
      space: remoteEmbeddingSpace(fixture.remote)
    });
    const result = await searchWorld(worldId, '守灯人', { useSemantic: true });
    expect(result.mode).toBe('lexical');
    expect(result.semantic).toMatchObject({ fresh: false, reason: 'embedding_space_mismatch' });
    expect(result.hits[0].denseScore).toBe(0);
  });

  it.each(['model', 'dtype', 'dimensions'] as const)(
    'treats a changed local %s as stale before generating a query',
    async (field) => {
      await indexWorldSemantic(worldId);
      if (field === 'dimensions') fixture.local.dimensions = 3;
      else fixture.local[field] = 'different';
      expect(await getSemanticIndexStatus(worldId)).toMatchObject({ fresh: false, indexed: 0 });
      const result = await searchWorld(worldId, '守灯人', { useSemantic: true });
      expect(result.semantic.reason).toBe('stale_index');
      expect(fixture.embed).toHaveBeenCalledTimes(1); // Index only; no query/rebuild inference.
    }
  );

  it('GET leaves a legacy index stale without enqueueing or running a model', async () => {
    await indexWorldSemantic(worldId);
    await prisma.$executeRaw`
      UPDATE semantic_vectors SET "embeddingModel" = ${fixture.local.model}
      WHERE "worldId" = ${worldId}
    `;
    const response = await GET(new Request('http://fixture.invalid'), {
      params: Promise.resolve({ worldId })
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      semantic: { fresh: false, indexed: 0, reason: 'stale_index' },
      job: null
    });
    expect(await prisma.semanticIndexJob.count({ where: { worldId } })).toBe(0);
    expect(fixture.embed).toHaveBeenCalledTimes(1);
  });

  it('checks the stored vector dimension rather than trusting its dims column', async () => {
    await indexWorldSemantic(worldId);
    await prisma.$executeRaw`
      UPDATE semantic_vectors SET embedding = '[1,0,0]'::vector
      WHERE "worldId" = ${worldId}
    `;
    expect(await getSemanticIndexStatus(worldId)).toMatchObject({ fresh: false, indexed: 0 });
    const result = await searchWorld(worldId, '守灯人', { useSemantic: true });
    expect(result.mode).toBe('lexical');
    expect(result.semantic.reason).toBe('stale_index');
    expect(fixture.embed).toHaveBeenCalledTimes(1);
  });

  it('retains lexical hits when query embedding is unavailable', async () => {
    await indexWorldSemantic(worldId);
    fixture.embed.mockRejectedValue(new EmbeddingError('embedding_unavailable', 'unavailable'));
    const result = await searchWorld(worldId, '守灯人', { useSemantic: true });
    expect(result.mode).toBe('lexical');
    expect(result.semantic.reason).toBe('embedding_error');
    expect(result.hits[0].name).toBe('守灯人');
  });
});
