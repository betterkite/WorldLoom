import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/client';
import { createWorld } from '@/lib/worldbuilding/worlds';
import { submitChange } from '@/lib/governance/changes';
import { mergeWorld } from '@/lib/governance/merge';
import {
  enqueueSemanticIndex,
  getSemanticIndexStatus,
  markSemanticIndexJobFailed,
  searchWorld
} from '@/lib/retrieval/search';
import { getEmbeddingsConfig } from '@/lib/llm/config';
import { askWorld } from '@/lib/assistant/ask';
import { EmbeddingError } from '@/lib/llm/embeddings';
import { runEval } from '@/lib/evals/run';
import type { ChatResult } from '@/lib/llm/client';

async function cleanDb() {
  await prisma.$transaction([
    prisma.lintFinding.deleteMany(),
    prisma.qaRecord.deleteMany(),
    prisma.tombstone.deleteMany(),
    prisma.conflictRecord.deleteMany(),
    prisma.worldVersion.deleteMany(),
    prisma.change.deleteMany(),
    prisma.eventEdge.deleteMany(),
    prisma.relationshipEvent.deleteMany(),
    prisma.chronicleEvent.deleteMany(),
    prisma.entity.deleteMany(),
    prisma.epoch.deleteMany(),
    prisma.source.deleteMany(),
    prisma.world.deleteMany()
  ]);
}

const entity = (name: string, summary: string, kind = 'character') => ({
  kind,
  name,
  aliases: [],
  summary,
  content: `${name} ${summary}`,
  confidence: 'INFERRED',
  tags: [],
  sourceRefs: []
});

const uniformEmbedding = async (texts: string[]) => texts.map(() => [1, 0]);
const singleEmbedding = async () => [[1, 0]];
const semanticEmbedding = async (texts: string[]) =>
  texts.map((text) => (text.includes('守梦') ? [1, 0] : [0, 1]));
const citationChat = async (): Promise<ChatResult> => ({
  content: '向顶天是「在枯井底得残书的求道者」[1]。',
  profileId: 'fake',
  model: 'fake',
  usage: null,
  latencyMs: 1
});
const sedimentChat = async (): Promise<ChatResult> => ({
  content: '向顶天 [1] 与守梦人 [2] 曾结盟后反目。',
  profileId: 'fake',
  model: 'fake',
  usage: null,
  latencyMs: 1
});

async function buildFixtureWorld() {
  const world = await createWorld({ name: '梦舟世界', premise: '修行者以梦为舟' });
  const worldId = world.id;
  await submitChange(worldId, { kind: 'epoch_upsert', payload: { name: '渡梦纪', order: 0 } });
  await mergeWorld(worldId);
  const pending = async () => prisma.change.findMany({ where: { worldId, status: 'pending' } });
  const uidOf = async (prefix: string, name: string) => {
    const rows = await (async () => {
      const v = (await prisma.world.findUniqueOrThrow({ where: { id: worldId } })).masterVersion;
      return prisma.entity.findMany({ where: { worldId, version: v } });
    })();
    return rows.find((row) => row.name === name)!.uid;
  };

  await submitChange(worldId, {
    kind: 'entity_upsert',
    payload: entity('向顶天', '在枯井底得残书的求道者')
  });
  await submitChange(worldId, {
    kind: 'entity_upsert',
    payload: entity('守梦人', '守护梦界秩序的组织', 'organization')
  });
  await mergeWorld(worldId);
  const xiang = await uidOf('ent', '向顶天');
  const keeper = await uidOf('ent', '守梦人');

  const epochUid = (await prisma.epoch.findFirst({ where: { worldId } }))!.uid;
  await submitChange(worldId, {
    kind: 'event_upsert',
    payload: {
      title: '结盟',
      summary: '向顶天与守梦人结盟',
      epochUid,
      epochYear: 1,
      participantUids: [xiang, keeper],
      causeUids: [],
      effectUids: []
    }
  });
  await mergeWorld(worldId);
  const alliance = (
    await pending().then(async (rows) => {
      void rows;
      const v = (await prisma.world.findUniqueOrThrow({ where: { id: worldId } })).masterVersion;
      return prisma.chronicleEvent.findMany({ where: { worldId, version: v } });
    })
  ).find((e) => e.title === '结盟')!.uid;

  await submitChange(worldId, {
    kind: 'event_upsert',
    payload: {
      title: '反目',
      summary: '梦界裂隙导致决裂',
      epochUid,
      epochYear: 3,
      participantUids: [xiang, keeper],
      causeUids: [alliance],
      effectUids: []
    }
  });
  await mergeWorld(worldId);
  return { worldId, xiang, keeper, alliance };
}

describe('retrieval & assistant (Phase 4)', () => {
  let fixture: Awaited<ReturnType<typeof buildFixtureWorld>>;

  beforeEach(async () => {
    await cleanDb();
    fixture = await buildFixtureWorld();
  });

  it('A4-1: lexical search finds entities by name/summary (degraded mode honest)', async () => {
    const result = await searchWorld(fixture.worldId, '向顶天 求道');
    expect(result.mode).toBe('lexical'); // no embeddings configured
    expect(result.hits[0].name).toBe('向顶天');
    expect(result.hits[0].lexicalScore).toBeGreaterThan(0);
  });

  it('A4-1: failed embedding endpoint degrades to lexical without crashing', async () => {
    const result = await searchWorld(fixture.worldId, '向顶天', {
      useSemantic: true,
      embedFn: async () => {
        throw new EmbeddingError('embedding_upstream_error', 'endpoint down');
      }
    });
    expect(result.mode).toBe('lexical');
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it('A4-1: semantic mode stays lexical when the current version has no fresh index', async () => {
    const result = await searchWorld(fixture.worldId, '向顶天', {
      useSemantic: true,
      embedFn: singleEmbedding
    });
    expect(result.mode).toBe('lexical');
    expect(result.semantic).toMatchObject({
      indexed: 0,
      fresh: false,
      reason: 'no_index'
    });
  });

  it('P1: retrieval eval persists the actual mode and coverage evidence', async () => {
    const result = await runEval(fixture.worldId, [
      { query: '向顶天', expectedUid: fixture.xiang }
    ]);
    expect(result.mode).toBe('lexical');
    expect(result.results[0]).toMatchObject({
      mode: 'lexical',
      semantic: { expected: expect.any(Number), fresh: false }
    });
    const run = await prisma.evalRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run.mode).toBe('lexical');
  });

  it('A4-1: fake embeddings participate in RRF fusion (hybrid mode)', async () => {
    // deterministic fake: query + 守梦人 docs align on dimension 0
    const { indexWorldSemantic } = await import('@/lib/retrieval/search');
    const indexed = await indexWorldSemantic(fixture.worldId, semanticEmbedding);
    expect({
      indexed: indexed.indexed,
      skipped: indexed.skipped,
      reason: indexed.reason
    }).toMatchObject({ indexed: expect.any(Number), skipped: false });

    const result = await searchWorld(fixture.worldId, '守梦秩序', {
      useSemantic: true,
      embedFn: semanticEmbedding
    });
    expect(result.mode).toBe('hybrid');
    expect(result.hits.some((hit) => hit.name === '守梦人')).toBe(true);
    expect(result.hits.some((hit) => hit.denseScore > 0)).toBe(true);
  });

  it('P1: semantic status rejects vectors produced by another embedding model', async () => {
    const { indexWorldSemantic } = await import('@/lib/retrieval/search');
    await indexWorldSemantic(fixture.worldId, uniformEmbedding);
    await prisma.$executeRaw`
      UPDATE semantic_vectors
      SET "embeddingModel" = 'different-model'
      WHERE "worldId" = ${fixture.worldId}
    `;

    const status = await getSemanticIndexStatus(fixture.worldId);
    expect(status).toMatchObject({ indexed: 0, fresh: false, reason: 'stale_index' });
  });

  it('P1: semantic refresh is durably queued per world version', async () => {
    const config = getEmbeddingsConfig();
    if (!config) return;
    const previous = process.env[config.credentialEnv];
    process.env[config.credentialEnv] = 'test-only-not-a-secret';
    try {
      const version = (await prisma.world.findUniqueOrThrow({ where: { id: fixture.worldId } }))
        .masterVersion;
      const job = await enqueueSemanticIndex(fixture.worldId, version);
      expect(job).toMatchObject({ worldId: fixture.worldId, version, status: 'queued' });
      const duplicate = await enqueueSemanticIndex(fixture.worldId, version);
      expect(duplicate?.id).toBe(job?.id);

      await submitChange(fixture.worldId, {
        kind: 'entity_upsert',
        payload: entity('后台索引验证', '用于验证合并后的自动索引任务')
      });
      const merged = await mergeWorld(fixture.worldId, 'queue semantic refresh');
      expect(merged.semanticIndexJobId).toBeTruthy();
    } finally {
      if (previous === undefined) delete process.env[config.credentialEnv];
      else process.env[config.credentialEnv] = previous;
    }
  });

  it('P1: semantic provider failures become safe durable job errors', async () => {
    const config = getEmbeddingsConfig();
    if (!config) return;
    const previous = process.env[config.credentialEnv];
    process.env[config.credentialEnv] = 'test-only-not-a-secret';
    try {
      const version = (await prisma.world.findUniqueOrThrow({ where: { id: fixture.worldId } }))
        .masterVersion;
      const job = await enqueueSemanticIndex(fixture.worldId, version);
      await markSemanticIndexJobFailed(
        fixture.worldId,
        version,
        new EmbeddingError('embedding_upstream_error', 'provider body contains account details', {
          status: 402
        })
      );
      const stored = await prisma.semanticIndexJob.findUniqueOrThrow({ where: { id: job!.id } });
      expect(stored.status).toBe('failed');
      expect(stored.error).toBe('embedding_upstream_error (402)');
      expect(stored.error).not.toContain('account details');
    } finally {
      if (previous === undefined) delete process.env[config.credentialEnv];
      else process.env[config.credentialEnv] = previous;
    }
  });

  it('A4-3: multi-hop expands causal neighbours of matched events', async () => {
    const result = await searchWorld(fixture.worldId, '结盟');
    const names = result.hits.map((hit) => hit.name);
    expect(names).toContain('结盟');
    expect(names).toContain('反目'); // direct consequence via event edge
  });

  it('A4-2: assistant answers with [n] citations and records QaRecord', async () => {
    const result = await askWorld(fixture.worldId, {
      question: '向顶天是谁？',
      chatFn: citationChat
    });
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations[0].name).toBe('向顶天');
    expect(result.answer).toContain('[1]');
    const record = await prisma.qaRecord.findUniqueOrThrow({ where: { id: result.qaId } });
    expect(record.question).toBe('向顶天是谁？');
  });

  it('A4-4: zero-evidence question answers honestly (rewrite attempted once)', async () => {
    let calls = 0;
    const chatFn = async (): Promise<ChatResult> => {
      calls += 1;
      return {
        content: '完全不相关xyz123',
        profileId: 'fake',
        model: 'fake',
        usage: null,
        latencyMs: 1
      };
    };
    const result = await askWorld(fixture.worldId, { question: '完全不相关xyz123 的颜色', chatFn });
    expect(result.answer).toContain('未找到足够依据');
    expect(calls).toBe(1); // rewrite only; no answer call without evidence
  });

  it('A4-5: explicit sediment stages a concept entity draft on the review chain', async () => {
    const result = await askWorld(fixture.worldId, {
      question: '向顶天和守梦人的关系',
      sediment: true,
      chatFn: sedimentChat
    });
    expect(result.citations.length).toBeGreaterThanOrEqual(2);
    const sedimentChange = await prisma.change.findFirst({
      where: { worldId: fixture.worldId, author: 'assistant', status: 'pending' }
    });
    expect(sedimentChange).not.toBeNull();
    const payload = sedimentChange!.payload as { tags: string[]; kind: string };
    expect(payload.tags).toContain('qa-sediment');
    expect(payload.kind).toBe('concept');
  });
});
