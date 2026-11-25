import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/client';
import { MAX_AUTOMATIC_WORKER_RECOVERIES } from '@/lib/worker/policy';

const mocks = vi.hoisted(() => ({ embed: vi.fn() }));
vi.mock('@/lib/llm/embeddings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/llm/embeddings')>()),
  embed: mocks.embed,
  embedWithSpace: async (texts: string[]) => ({
    vectors: await mocks.embed(texts),
    space: {
      id: 'synthetic-worker-space',
      backend: 'local' as const,
      model: 'synthetic',
      dimensions: 2,
      dtype: 'int8'
    }
  })
}));
vi.mock('@/lib/llm/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/llm/config')>()),
  isSemanticEnabled: () => true
}));

import { EmbeddingError } from '@/lib/llm/embeddings';
import {
  enqueueSemanticIndex,
  runSemanticIndexJob,
  SEMANTIC_JOB_STALE_MS
} from '@/lib/retrieval/search';

let worldId: string;
beforeEach(async () => {
  mocks.embed.mockReset().mockImplementation(async (texts: string[]) => texts.map(() => [1, 0]));
  const world = await prisma.world.create({ data: { name: `CAS fixture ${randomUUID()}` } });
  worldId = world.id;
  await prisma.entity.create({
    data: {
      worldId,
      version: 1,
      uid: `cas_${randomUUID()}`,
      kind: 'concept',
      name: 'CAS fixture',
      summary: 'Synthetic concurrency probe',
      content: 'No provider or user data'
    }
  });
});
afterEach(async () => {
  await prisma.world.deleteMany({ where: { id: worldId } });
});

describe('semantic worker durable claim (real test DB, fake embedding)', () => {
  it('allows exactly one concurrent claimant and keeps replayed vectors unique', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.embed.mockImplementation(async () => {
      await barrier;
      return [[1, 0]];
    });
    const job = await enqueueSemanticIndex(worldId, 1);
    expect(job).not.toBeNull();
    const settled: unknown[] = [];
    const attempts = [runSemanticIndexJob(job!.id), runSemanticIndexJob(job!.id)].map((promise) =>
      promise.then((value) => {
        settled.push(value);
        return value;
      })
    );
    try {
      await vi.waitFor(() => {
        expect(mocks.embed).toHaveBeenCalledOnce();
        expect(settled).toHaveLength(1); // The losing CAS returns while the owner is still embedding.
      });
      const running = await prisma.semanticIndexJob.findUniqueOrThrow({ where: { id: job!.id } });
      expect(running).toMatchObject({ status: 'running', attempts: 1, recoveryAttempts: 0 });
    } finally {
      release();
      await Promise.all(attempts);
    }
    const completed = await runSemanticIndexJob(job!.id);
    expect(completed).toMatchObject({ status: 'completed', attempts: 1, indexed: 1 });
    expect(mocks.embed).toHaveBeenCalledOnce(); // Completed redelivery is a no-op.
    const retry = await enqueueSemanticIndex(worldId, 1, { manualRetry: true });
    expect(retry).toMatchObject({ id: job!.id, status: 'queued', attempts: 1 });
    const replay = await runSemanticIndexJob(job!.id);
    expect(replay).toMatchObject({ status: 'completed', attempts: 2, indexed: 1 });
    const vectors = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM semantic_vectors WHERE "worldId" = ${worldId}
    `;
    expect(vectors[0].count).toBe(1);
  });

  it('enforces the automatic recovery budget even with competing claimants', async () => {
    const job = await enqueueSemanticIndex(worldId, 1);
    await prisma.semanticIndexJob.update({
      where: { id: job!.id },
      data: {
        status: 'running',
        attempts: 4,
        recoveryAttempts: MAX_AUTOMATIC_WORKER_RECOVERIES,
        lastHeartbeatAt: new Date(Date.now() - SEMANTIC_JOB_STALE_MS - 1000)
      }
    });
    await Promise.all([runSemanticIndexJob(job!.id), runSemanticIndexJob(job!.id)]);
    const failed = await prisma.semanticIndexJob.findUniqueOrThrow({ where: { id: job!.id } });
    expect(failed).toMatchObject({
      status: 'failed',
      attempts: 4,
      recoveryAttempts: MAX_AUTOMATIC_WORKER_RECOVERIES,
      error: 'worker_recovery_limit_reached'
    });
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it.each([
    [
      new EmbeddingError('embedding_upstream_error', 'private provider account and credential', {
        status: 402
      }),
      'embedding_upstream_error (402)'
    ],
    [new Error('private provider account and credential'), 'semantic_index_failed']
  ])('persists only a safe code after executor failure', async (error, expected) => {
    mocks.embed.mockRejectedValue(error);
    const job = await enqueueSemanticIndex(worldId, 1);
    const result = await runSemanticIndexJob(job!.id);
    expect(result).toMatchObject({ status: 'failed', attempts: 1, error: expected });
    expect(result?.error).not.toContain('private');
  });
});
