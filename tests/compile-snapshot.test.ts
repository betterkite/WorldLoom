import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/client';
import { createWorld } from '@/lib/worldbuilding/worlds';
import { createSource } from '@/lib/intake/sources';
import { createManuscript, createChapterCompileRun } from '@/lib/worldbuilding/manuscript';
import { submitChange } from '@/lib/governance/changes';
import { mergeWorld } from '@/lib/governance/merge';
import { handleMcpRequest } from '@/lib/mcp/server';
import { POST as compileSource } from '@/app/api/worlds/[worldId]/sources/[sourceId]/compile/route';
import type { NextRequest } from 'next/server';

const queuedExecution = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/worldbuilding/compile-run', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/worldbuilding/compile-run')>()),
  executeCompileRun: queuedExecution
}));
import { createCompileRun } from '@/lib/worldbuilding/compile-run';
const { executeCompileRun: executeActual } = await vi.importActual<
  typeof import('@/lib/worldbuilding/compile-run')
>('@/lib/worldbuilding/compile-run');

const BARRIER = 79100219;

async function waitForWaiters(count: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
      SELECT count(*) AS waiting FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
    if (Number(row.waiting) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected ${count} real advisory-lock waiters`);
}

function holdBarrier() {
  let ready!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finished = prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BARRIER}::bigint)`;
      ready();
      await hold;
    },
    { timeout: 15000 }
  );
  return { entered, finished, release: () => release() };
}

async function installBarrier(table: 'compile_runs' | 'worlds', action: 'INSERT' | 'UPDATE') {
  // Static test-only trigger names and SQL; only the disposable test DB is allowed.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION worldloom_test_snapshot_barrier() RETURNS trigger AS $$
    BEGIN PERFORM pg_advisory_xact_lock(79100219::bigint); RETURN NEW; END;
    $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER worldloom_test_snapshot_barrier BEFORE ${action}
    ON ${table} FOR EACH ROW EXECUTE FUNCTION worldloom_test_snapshot_barrier()`);
}

async function removeBarrier(table: 'compile_runs' | 'worlds') {
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS worldloom_test_snapshot_barrier ON ${table}`
  );
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS worldloom_test_snapshot_barrier()');
}

async function addEntity(worldId: string, name: string) {
  return submitChange(
    worldId,
    {
      kind: 'entity_upsert',
      payload: {
        kind: 'character',
        name,
        aliases: [],
        summary: '',
        content: '',
        confidence: 'EXTRACTED',
        tags: [],
        sourceRefs: []
      }
    },
    { pendingOnly: true }
  );
}

async function readCatalog(worldId: string, version: number) {
  const [epochs, entities, events] = await Promise.all([
    prisma.epoch.findMany({
      where: { worldId, version },
      select: { uid: true, name: true },
      orderBy: { uid: 'asc' }
    }),
    prisma.entity.findMany({
      where: { worldId, version },
      select: { uid: true, name: true, kind: true },
      orderBy: { uid: 'asc' }
    }),
    prisma.chronicleEvent.findMany({
      where: { worldId, version },
      select: { uid: true, title: true },
      orderBy: { uid: 'asc' }
    })
  ]);
  return { epochs, entities, events };
}

async function prepareIngress(worldId: string, kind: 'mcp' | 'source' | 'chapter') {
  if (kind === 'chapter') {
    const manuscript = await createManuscript(worldId, {
      title: 'Snapshot',
      chapters: [{ title: 'One', content: 'Synthetic chapter.' }]
    });
    return async () =>
      (await createChapterCompileRun(worldId, manuscript.id, manuscript.chapters[0].id)).run;
  }
  if (kind === 'source') {
    const { source } = await createSource(worldId, {
      filename: 'snapshot.txt',
      content: 'Synthetic source.'
    });
    return async () => {
      const response = await compileSource({} as NextRequest, {
        params: Promise.resolve({ worldId, sourceId: source.id })
      });
      expect(response.status).toBe(202);
      const body = await response.json();
      return prisma.compileRun.findUniqueOrThrow({ where: { id: body.runId } });
    };
  }
  return async () => {
    const response = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'compile_source',
        arguments: { worldId, content: 'Synthetic MCP source.' }
      }
    });
    if (!('result' in response)) throw new Error('MCP queue failed');
    const result = response.result as { content: Array<{ text: string }> };
    const body = JSON.parse(result.content[0].text);
    return prisma.compileRun.findUniqueOrThrow({ where: { id: body.runId } });
  };
}

describe('compile snapshot consistency with real PostgreSQL', () => {
  let worldId: string;
  beforeEach(async () => {
    queuedExecution.mockClear();
    await prisma.world.deleteMany();
    worldId = (await createWorld({ name: 'Snapshot world', premise: 'Synthetic only' })).id;
    await addEntity(worldId, 'Original A');
    await addEntity(worldId, 'Original B');
    await mergeWorld(worldId);
  });

  it.each(['mcp', 'source', 'chapter'] as const)(
    '%s keeps catalog and base version together while a real merge waits',
    async (kind) => {
      const queue = await prepareIngress(worldId, kind);
      const original = await readCatalog(worldId, 2);
      await addEntity(worldId, 'New after creation');
      await installBarrier('compile_runs', 'INSERT');
      const barrier = holdBarrier();
      let creation: ReturnType<typeof queue> | undefined;
      let merging: ReturnType<typeof mergeWorld> | undefined;
      try {
        await barrier.entered;
        creation = queue();
        await waitForWaiters(1); // insertion reached after snapshot reads
        merging = mergeWorld(worldId);
        await waitForWaiters(2); // merge is genuinely blocked by creation's world lock
        barrier.release();
        await barrier.finished;
        const run = await creation;
        await merging;
        expect(run.baseVersion).toBe(2);
        expect((run.context as { catalog: unknown }).catalog).toEqual(original);
        expect(
          (await prisma.world.findUniqueOrThrow({ where: { id: worldId } })).masterVersion
        ).toBe(3);
        expect((await readCatalog(worldId, 3)).entities).toHaveLength(3);
        expect((await readCatalog(worldId, 2)).entities).toHaveLength(2);
      } finally {
        barrier.release();
        await Promise.allSettled([barrier.finished, creation, merging]);
        await removeBarrier('compile_runs');
      }
    }
  );

  it('captures the new version when merge holds the world lock before creation', async () => {
    const queue = await prepareIngress(worldId, 'source');
    await addEntity(worldId, 'Merged first');
    await installBarrier('worlds', 'UPDATE');
    const barrier = holdBarrier();
    let merging: ReturnType<typeof mergeWorld> | undefined;
    let creation: ReturnType<typeof queue> | undefined;
    try {
      await barrier.entered;
      merging = mergeWorld(worldId);
      await waitForWaiters(1);
      creation = queue();
      await waitForWaiters(2);
      barrier.release();
      await barrier.finished;
      await merging;
      const run = await creation;
      expect(run.baseVersion).toBe(3);
      expect((run.context as { catalog: unknown }).catalog).toEqual(await readCatalog(worldId, 3));
    } finally {
      barrier.release();
      await Promise.allSettled([barrier.finished, creation, merging]);
      await removeBarrier('worlds');
    }
  });

  it('reuses concurrent matching requests and preserves the original text', async () => {
    const input = {
      kind: 'source' as const,
      sourceFilename: 'raw.txt',
      sourceContent: '重复\n原文\n\n  '
    };
    const results = await Promise.all([
      createCompileRun(worldId, input),
      createCompileRun(worldId, input),
      createCompileRun(worldId, input)
    ]);
    expect(new Set(results.map(({ run }) => run.id)).size).toBe(1);
    expect(results.filter(({ reused }) => reused)).toHaveLength(2);
    expect(results[0].run.chunks.map((chunk) => chunk.content).join('')).toBe(input.sourceContent);
  });

  it('rejects a mislabeled legacy context before model calls and does not reuse or rewrite it', async () => {
    const input = {
      kind: 'source' as const,
      sourceFilename: 'legacy.txt',
      sourceContent: 'Legacy synthetic source.'
    };
    const first = await createCompileRun(worldId, input);
    const badContext = {
      ...(first.run.context as object),
      catalog: { epochs: [], entities: [], events: [] }
    };
    await prisma.compileRun.update({ where: { id: first.run.id }, data: { context: badContext } });
    const replacement = await createCompileRun(worldId, input);
    expect(replacement.reused).toBe(false);
    expect(replacement.run.id).not.toBe(first.run.id);
    const runner = vi.fn(async () => {
      throw new Error('Must not call model');
    });
    const failed = await executeActual(first.run.id, runner);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('context does not match its recorded version');
    expect(runner).not.toHaveBeenCalled();
    expect(failed.context).toEqual(badContext);
    expect(failed.baseVersion).toBe(2);
    expect(await prisma.change.count({ where: { worldId, status: 'pending' } })).toBe(0);
  });

  it('accepts valid older catalog ordering without rewriting stored context', async () => {
    const created = await createCompileRun(worldId, {
      kind: 'source',
      sourceFilename: 'ordered.txt',
      sourceContent: 'Synthetic text.'
    });
    const catalog = await readCatalog(worldId, 2);
    const context = {
      ...(created.run.context as object),
      catalog: { ...catalog, entities: catalog.entities.toReversed() }
    };
    await prisma.compileRun.update({ where: { id: created.run.id }, data: { context } });
    let calls = 0;
    const run = await executeActual(created.run.id, async () => ({
      content:
        ++calls === 1
          ? JSON.stringify({
              world_facts: [],
              contradictions: [],
              entity_threads: [],
              event_threads: [],
              open_questions: []
            })
          : JSON.stringify({ epochs: [], entities: [], events: [], relations: [] }),
      profileId: 'fake',
      model: 'fake',
      usage: null,
      latencyMs: 1
    }));
    expect(run.status).toBe('completed');
    expect(calls).toBe(2);
    expect(run.context).toEqual(context);
    expect(run.baseVersion).toBe(2);
    expect((await prisma.world.findUniqueOrThrow({ where: { id: worldId } })).masterVersion).toBe(
      2
    );
  });
});
