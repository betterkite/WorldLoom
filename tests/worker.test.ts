import { vi, describe, expect, it } from 'vitest';

const mocks = vi.hoisted(() => ({
  compileFindMany: vi.fn(),
  semanticFindMany: vi.fn(),
  executeCompileRun: vi.fn(),
  recoverStaleCompileRun: vi.fn(),
  runSemanticIndexJob: vi.fn()
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    compileRun: { findMany: mocks.compileFindMany },
    semanticIndexJob: { findMany: mocks.semanticFindMany }
  }
}));

vi.mock('@/lib/worldbuilding/compile-run', () => ({
  COMPILE_RUN_STALE_AFTER_MS: 120_000,
  executeCompileRun: mocks.executeCompileRun,
  recoverStaleCompileRun: mocks.recoverStaleCompileRun
}));

vi.mock('@/lib/retrieval/search', () => ({
  SEMANTIC_JOB_STALE_MS: 120_000,
  runSemanticIndexJob: mocks.runSemanticIndexJob
}));

import { getWorkerMaxConcurrency, runWorkerTick } from '@/lib/worker/background';

describe('background worker concurrency contract', () => {
  it('uses a bounded default and accepts an explicit deployment cap', () => {
    expect(getWorkerMaxConcurrency({})).toBe(4);
    expect(getWorkerMaxConcurrency({ WORLDLOOM_WORKER_MAX_CONCURRENCY: '2' })).toBe(2);
    expect(getWorkerMaxConcurrency({ WORLDLOOM_WORKER_MAX_CONCURRENCY: '32' })).toBe(32);
  });

  it('rejects invalid or unsafe concurrency values', () => {
    for (const value of ['0', '-1', '33', '4junk', '2.5', '']) {
      expect(() => getWorkerMaxConcurrency({ WORLDLOOM_WORKER_MAX_CONCURRENCY: value })).toThrow(
        'WORLDLOOM_WORKER_MAX_CONCURRENCY must be an integer from 1 to 32'
      );
    }
  });

  it('does not start more detached jobs than the process cap across overlapping ticks', async () => {
    const resolvers: (() => void)[] = [];
    mocks.compileFindMany.mockImplementation(
      (args: { where?: { status?: string }; take?: number }) => {
        if (args.where?.status === 'running') return Promise.resolve([]);
        return Promise.resolve(
          Array.from({ length: 10 }, (_, index) => ({
            id: `run-${index}`,
            worldId: 'world-1'
          })).slice(0, args.take)
        );
      }
    );
    mocks.semanticFindMany.mockResolvedValue([]);
    mocks.executeCompileRun.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        })
    );

    const first = await runWorkerTick();
    expect(first.startedCompileRuns).toBe(4);
    expect(first.startedSemanticJobs).toBe(0);
    expect(first.activeTasks).toBe(4);
    expect(mocks.executeCompileRun).toHaveBeenCalledTimes(4);

    const second = await runWorkerTick();
    expect(second.startedCompileRuns).toBe(0);
    expect(second.startedSemanticJobs).toBe(0);
    expect(mocks.executeCompileRun).toHaveBeenCalledTimes(4);

    resolvers.forEach((resolve) => resolve());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
