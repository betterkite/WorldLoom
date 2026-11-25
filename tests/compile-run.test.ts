import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/client';
import { createWorld } from '@/lib/worldbuilding/worlds';
import type { ChatFn } from '@/lib/worldbuilding/genesis';
import {
  cancelCompileRun,
  COMPILE_RUN_STALE_AFTER_MS,
  createCompileRun,
  executeCompileRun,
  compileRunUsageSummary,
  recoverStaleCompileRun,
  resumeCompileRun
} from '@/lib/worldbuilding/compile-run';
import { createChapterCompileRun } from '@/lib/worldbuilding/manuscript';
import { createManuscript } from '@/lib/worldbuilding/manuscript';
import { listChangesDetailed, submitChange } from '@/lib/governance/changes';
import { mergeWorld } from '@/lib/governance/merge';
import { MAX_AUTOMATIC_WORKER_RECOVERIES } from '@/lib/worker/policy';
import { getExecutionLimiter } from '@/lib/worker/execution';

const ANALYSIS = JSON.stringify({
  world_facts: ['分块事实'],
  contradictions: [],
  entity_threads: [],
  event_threads: [],
  open_questions: []
});

const GENERATED = JSON.stringify({
  epochs: [{ name: '初纪', order: 0, description: '' }],
  entities: [
    {
      kind: 'character',
      name: '分块角色',
      aliases: [],
      summary: '角色',
      content: '角色内容',
      confidence: 'EXTRACTED',
      tags: []
    },
    {
      kind: 'location',
      name: '分块地点',
      aliases: [],
      summary: '地点',
      content: '地点内容',
      confidence: 'INFERRED',
      tags: []
    }
  ],
  events: [
    {
      title: '分块事件',
      summary: '事件',
      content: '事件内容',
      epochName: '初纪',
      year: 1,
      participants: ['分块角色'],
      location: '分块地点',
      causes: [],
      confidence: 'EXTRACTED'
    }
  ],
  relations: [
    {
      subject: '分块角色',
      object: '分块地点',
      relation: '位于',
      polarity: 'establish',
      eventName: '分块事件'
    }
  ]
});

async function cleanDb() {
  await prisma.$transaction([
    prisma.compileChunk.deleteMany(),
    prisma.compileRun.deleteMany(),
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

function scriptedChat(options: { failAt?: number } = {}) {
  let calls = 0;
  const chat: ChatFn & { calls: () => number } = Object.assign(
    async () => {
      calls += 1;
      if (options.failAt === calls) throw new Error('temporary provider failure');
      return {
        content: calls % 2 === 1 ? ANALYSIS : GENERATED,
        profileId: 'fake',
        model: 'fake',
        usage: { inputTokens: calls, outputTokens: calls + 1 },
        latencyMs: 1
      };
    },
    { calls: () => calls }
  );
  return chat;
}

function heldChat(stage: 'analysis' | 'generation', reject = false) {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  const runner: ChatFn = async (request) => {
    const generation = request.messages.some((message) => message.content.includes('【素材分析】'));
    if (!held && generation === (stage === 'generation')) {
      held = true;
      entered();
      await barrier;
      if (reject) throw new Error('late obsolete provider error');
    }
    return {
      content: generation ? GENERATED : ANALYSIS,
      model: 'fake',
      profileId: 'fake',
      usage: null,
      latencyMs: 1
    };
  };
  return { runner, started, release: () => release() };
}

describe('durable compiler runs (ISS-31)', () => {
  let worldId: string;

  beforeEach(async () => {
    await cleanDb();
    worldId = (await createWorld({ name: '测试世界', premise: '测试前提' })).id;
  });

  it('caps API-style bursts before model work and skips a cancelled slot waiter', async () => {
    const limiter = getExecutionLimiter();
    const cap = limiter.snapshot().limit;
    let releaseCalls!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseCalls = resolve;
    });
    let entered = 0;
    const runner: ChatFn = async (request) => {
      const generation = request.messages.some((message) =>
        message.content.includes('【素材分析】')
      );
      if (!generation) {
        entered += 1;
        await barrier;
      }
      return {
        content: generation ? GENERATED : ANALYSIS,
        model: 'fake',
        profileId: 'fake',
        usage: null,
        latencyMs: 1
      };
    };
    const created = await Promise.all(
      Array.from({ length: cap + 1 }, (_, index) =>
        createCompileRun(worldId, {
          kind: 'source',
          sourceFilename: `burst-${index}.txt`,
          sourceContent: `unique-${index}`
        })
      )
    );
    const executions = created.map(({ run }) => executeCompileRun(run.id, runner));
    try {
      const deadline = Date.now() + 2_000;
      while (true) {
        if (entered >= cap && limiter.snapshot().waiting >= 1) break;
        if (Date.now() > deadline) throw new Error('execution gate was not reached');
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(entered).toBe(cap);
      const runs = await prisma.compileRun.findMany({ where: { worldId, status: 'running' } });
      // CAS ownership is recorded before the process-local slot. Redelivery
      // still returns immediately; waiting owners continue heartbeating.
      expect(runs).toHaveLength(cap + 1);
      const chunks = await prisma.compileChunk.findMany({
        where: { runId: { in: runs.map((run) => run.id) }, status: 'pending' }
      });
      expect(chunks).toHaveLength(1);
      await cancelCompileRun(worldId, chunks[0].runId);
      const owner = runs.find((run) => run.id !== chunks[0].runId)!;
      expect((await executeCompileRun(owner.id, runner)).status).toBe('running');
    } finally {
      releaseCalls();
      await Promise.all(executions);
    }
    expect(entered).toBe(cap);
    expect(limiter.snapshot()).toMatchObject({ active: 0, waiting: 0 });
  });

  it('checkpoints completed chunks and resumes only the failed chunk', async () => {
    const source = await prisma.source.create({
      data: {
        worldId,
        uid: 'src_compile_run',
        filename: '测试素材.md',
        content: '甲'.repeat(1_200),
        contentHash: 'compile-run-hash',
        sizeBytes: 1_200
      }
    });
    const created = await createCompileRun(worldId, {
      kind: 'source',
      sourceId: source.id,
      sourceFilename: source.filename,
      sourceContent: source.content
    });
    expect(created.run.totalChunks).toBe(2);

    const failed = await executeCompileRun(created.run.id, scriptedChat({ failAt: 3 }));
    expect(failed.status).toBe('failed');
    expect(failed.completedChunks).toBe(1);
    expect(failed.chunks.map((chunk) => chunk.status)).toEqual(['completed', 'failed']);
    expect(await prisma.change.count({ where: { worldId } })).toBe(0);

    await resumeCompileRun(worldId, created.run.id);
    const healthy = scriptedChat();
    const completed = await executeCompileRun(created.run.id, healthy);
    expect(completed.status).toBe('completed');
    expect(completed.completedChunks).toBe(2);
    const usage = compileRunUsageSummary({
      ...completed,
      chunks: completed.chunks
    });
    expect(usage).toMatchObject({
      expectedCalls: 4,
      observedCalls: 4,
      usageCalls: 4,
      usageComplete: true,
      totalTokens: 16
    });
    expect(healthy.calls()).toBe(2);
    expect((await prisma.source.findUniqueOrThrow({ where: { id: source.id } })).status).toBe(
      'compiled'
    );
    const changes = await prisma.change.findMany({ where: { worldId } });
    expect(changes.length).toBeGreaterThan(0);
    expect(new Set(changes.map((change) => change.batchId))).toEqual(new Set([completed.batchId]));
    const epochChange = changes.find((change) => change.kind === 'epoch_upsert');
    expect(epochChange).toBeDefined();
    if (!epochChange) throw new Error('epoch change was not staged');
    expect(epochChange?.provenance).toMatchObject({
      runId: completed.id,
      sourceUid: source.uid,
      sourceHash: completed.sourceHash,
      chunkIndexes: [0, 1],
      promptVersion: 'compile-v1'
    });
    expect((epochChange.payload as { sourceRefs: string[] }).sourceRefs).toEqual([source.uid]);
    expect(epochChange.candidatePayload).toEqual(epochChange.payload);
    const provenance = epochChange.provenance as {
      analysis: unknown[];
      generation: unknown[];
      sourceRanges: unknown[];
    };
    expect(provenance.analysis).toHaveLength(2);
    expect(provenance.generation).toHaveLength(2);
    expect(provenance.sourceRanges).toHaveLength(2);
    const detailedChanges = await listChangesDetailed(worldId, 'pending');
    const detailedEpoch = detailedChanges.find((change) => change.id === epochChange.id);
    expect(detailedEpoch?.sourceEvidence).toHaveLength(2);
    expect(detailedEpoch?.sourceEvidence[0]).toMatchObject({
      sourceUid: source.uid,
      hashMatches: true,
      sourceHashMatches: true
    });
    expect(detailedEpoch?.candidatePayload).toEqual(detailedEpoch?.payload);

    const merged = await mergeWorld(worldId, 'merge compiled provenance');
    const masterEpoch = await prisma.epoch.findFirstOrThrow({
      where: { worldId, version: merged.version, name: '初纪' }
    });
    const masterEntity = await prisma.entity.findFirstOrThrow({
      where: { worldId, version: merged.version, name: '分块角色' }
    });
    const masterEvent = await prisma.chronicleEvent.findFirstOrThrow({
      where: { worldId, version: merged.version, title: '分块事件' }
    });
    const masterRelation = await prisma.relationshipEvent.findFirstOrThrow({
      where: { worldId, version: merged.version, relation: '位于' }
    });
    for (const row of [masterEpoch, masterEntity, masterEvent, masterRelation]) {
      expect(row.sourceRefs).toEqual([source.uid]);
    }

    const callsBeforeNoop = healthy.calls();
    await executeCompileRun(created.run.id, healthy);
    expect(healthy.calls()).toBe(callsBeforeNoop);
  });

  it('allows only one concurrent executor to claim a durable run', async () => {
    const created = await createCompileRun(worldId, {
      kind: 'source',
      sourceFilename: '并发领取.md',
      sourceContent: '唯一分块'
    });
    let calls = 0;
    let signalStarted!: () => void;
    let releaseFirstCall!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseFirstCall = resolve;
    });
    const runner: ChatFn = async () => {
      calls += 1;
      if (calls === 1) {
        signalStarted();
        await blocked;
      }
      return {
        content: calls % 2 === 1 ? ANALYSIS : GENERATED,
        profileId: 'fake',
        model: 'fake',
        usage: { inputTokens: calls, outputTokens: calls + 1 },
        latencyMs: 1
      };
    };

    const firstExecution = executeCompileRun(created.run.id, runner);
    await started;
    const competingExecution = await executeCompileRun(created.run.id, runner);
    expect(competingExecution.status).toBe('running');
    expect(calls).toBe(1);

    releaseFirstCall();
    const completed = await firstExecution;
    expect(completed.status).toBe('completed');
    expect(calls).toBe(2);
  });

  it('cancelled runs do not call the model or stage changes', async () => {
    const created = await createCompileRun(worldId, {
      kind: 'source',
      sourceFilename: '取消.md',
      sourceContent: '乙'.repeat(1_200)
    });
    await cancelCompileRun(worldId, created.run.id);
    const chat = scriptedChat();
    const cancelled = await executeCompileRun(created.run.id, chat);
    expect(cancelled.status).toBe('cancelled');
    expect(chat.calls()).toBe(0);
    expect(await prisma.change.count({ where: { worldId } })).toBe(0);
  });

  it.each(['analysis', 'generation'] as const)(
    'fences cancellation during %s before any staging/finalization',
    async (stage) => {
      const manuscript = await createManuscript(worldId, {
        title: '取消中',
        chapters: [{ content: '取消测试' }]
      });
      const chapter = manuscript.chapters[0];
      const created = await createChapterCompileRun(worldId, manuscript.id, chapter.id);
      const held = heldChat(stage);
      const execution = executeCompileRun(created.run.id, held.runner);
      try {
        await held.started;
        expect((await cancelCompileRun(worldId, created.run.id)).status).toBe('cancelled');
      } finally {
        held.release();
      }
      const result = await execution;
      expect(result.status).toBe('cancelled');
      expect(result.completedChunks).toBe(0);
      expect(result.chunks[0].generated).toBeNull();
      expect(await prisma.change.count({ where: { worldId } })).toBe(0);
      expect((await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } })).status).toBe(
        'draft'
      );
      expect(
        (await prisma.source.findUniqueOrThrow({ where: { id: result.sourceId! } })).status
      ).toBe('staged');
      expect(await prisma.worldVersion.count({ where: { worldId } })).toBe(1);
    }
  );

  it.each(['analysis', 'generation'] as const)(
    'does not replace cancellation with a late %s error or degrade the chapter',
    async (stage) => {
      const manuscript = await createManuscript(worldId, {
        title: '晚到错误',
        chapters: [{ content: '取消测试' }]
      });
      const created = await createChapterCompileRun(
        worldId,
        manuscript.id,
        manuscript.chapters[0].id
      );
      const held = heldChat(stage, true);
      const execution = executeCompileRun(created.run.id, held.runner);
      let cancelled;
      try {
        await held.started;
        cancelled = await cancelCompileRun(worldId, created.run.id);
      } finally {
        held.release();
      }
      const result = await execution;
      expect(result.status).toBe('cancelled');
      expect(result.error).toBe('Cancelled by user');
      expect(result.finishedAt).toEqual(cancelled!.finishedAt);
      expect(result.result).toBeNull();
      expect(result.chunks[0].status).toBe(stage === 'generation' ? 'generating' : 'analyzing');
      expect(result.chunks[0].generationMeta).toBeNull();
      expect(
        (await prisma.chapter.findUniqueOrThrow({ where: { id: manuscript.chapters[0].id } }))
          .status
      ).toBe('draft');
      expect(
        (await prisma.source.findUniqueOrThrow({ where: { id: result.sourceId! } })).status
      ).toBe('staged');
      expect(await prisma.change.count({ where: { worldId } })).toBe(0);
      expect(await prisma.source.count({ where: { worldId } })).toBe(1);
    }
  );

  it.each([false, true])(
    'fences a stale executor response/error after recovery (reject=%s)',
    async (reject) => {
      const created = await createCompileRun(worldId, {
        kind: 'source',
        sourceFilename: '旧执行者.txt',
        sourceContent: '恢复测试'
      });
      const held = heldChat('generation', reject);
      const obsolete = executeCompileRun(created.run.id, held.runner);
      let completed;
      try {
        await held.started;
        const future = new Date(Date.now() + COMPILE_RUN_STALE_AFTER_MS * 2);
        expect((await recoverStaleCompileRun(worldId, created.run.id, future)).status).toBe(
          'queued'
        );
        completed = await executeCompileRun(created.run.id, scriptedChat());
        expect(completed.status).toBe('completed');
        expect(completed.attempts).toBe(2);
      } finally {
        held.release();
      }
      const result = await obsolete;
      expect(result).toEqual(completed);
      expect(await prisma.change.count({ where: { worldId } })).toBe(5);
      expect(await prisma.worldVersion.count({ where: { worldId } })).toBe(1);
    }
  );

  it.each([
    { restart: 'recovery', reject: false },
    { restart: 'recovery', reject: true },
    { restart: 'cancel-resume', reject: false },
    { restart: 'cancel-resume', reject: true }
  ] as const)(
    'fences old results while the replacement is still running ($restart, reject=$reject)',
    async ({ restart, reject }) => {
      const manuscript = await createManuscript(worldId, {
        title: '新旧执行者交错',
        chapters: [{ content: '交错恢复测试' }]
      });
      const chapter = manuscript.chapters[0];
      const created = await createChapterCompileRun(worldId, manuscript.id, chapter.id);
      const old = heldChat('generation', reject);
      const replacement = heldChat('generation');
      const obsolete = executeCompileRun(created.run.id, old.runner);
      let current: ReturnType<typeof executeCompileRun> | undefined;
      const persisted = () =>
        prisma.compileRun.findUniqueOrThrow({
          where: { id: created.run.id },
          include: { chunks: { orderBy: { index: 'asc' } } }
        });
      try {
        await old.started;
        if (restart === 'recovery') {
          const future = new Date(Date.now() + COMPILE_RUN_STALE_AFTER_MS * 2);
          expect((await recoverStaleCompileRun(worldId, created.run.id, future)).status).toBe(
            'queued'
          );
        } else {
          await cancelCompileRun(worldId, created.run.id);
          await resumeCompileRun(worldId, created.run.id);
        }
        current = executeCompileRun(created.run.id, replacement.runner);
        await replacement.started;
        const before = await persisted();
        expect(before.status).toBe('running');
        expect(before.attempts).toBe(2);
        expect(before.chunks[0].status).toBe('generating');
        old.release();
        const obsoleteResult = await obsolete;
        expect(obsoleteResult.status).toBe('running');
        expect(obsoleteResult.attempts).toBe(2);
        // The new owner's regular heartbeat is allowed to advance independently.
        const after = await persisted();
        expect({ ...after, lastHeartbeatAt: null }).toEqual({ ...before, lastHeartbeatAt: null });
        expect(await prisma.change.count({ where: { worldId } })).toBe(0);
        expect((await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } })).status).toBe(
          'draft'
        );
        expect(
          (await prisma.source.findUniqueOrThrow({ where: { id: before.sourceId! } })).status
        ).toBe('staged');
      } finally {
        old.release();
        replacement.release();
        await Promise.allSettled([obsolete, ...(current ? [current] : [])]);
      }
      const completed = await current!;
      expect(completed.status).toBe('completed');
      expect(completed.attempts).toBe(2);
      expect(
        await prisma.change.count({
          where: { worldId, status: 'pending', batchId: completed.batchId }
        })
      ).toBe(5);
      expect((await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } })).status).toBe(
        'final'
      );
      expect(await prisma.worldVersion.count({ where: { worldId } })).toBe(1);
    }
  );

  it('rolls back staging when chapter finalization fails, then resumes with one pending batch', async () => {
    const manuscript = await createManuscript(worldId, {
      title: '原子完成',
      chapters: [{ content: '原子完成测试' }]
    });
    const created = await createChapterCompileRun(
      worldId,
      manuscript.id,
      manuscript.chapters[0].id
    );
    // Integration-only fault in the throwaway database. It fires after staging,
    // not before, and does not prevent failure degradation back to draft.
    await prisma.$executeRawUnsafe(
      "CREATE FUNCTION worldloom_issue12_reject_final() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic finalization failure'; END $$"
    );
    try {
      await prisma.$executeRawUnsafe(
        "CREATE TRIGGER worldloom_issue12_reject_final BEFORE UPDATE ON chapters FOR EACH ROW WHEN (NEW.status = 'final') EXECUTE FUNCTION worldloom_issue12_reject_final()"
      );
      const failed = await executeCompileRun(created.run.id, scriptedChat());
      expect(failed.status).toBe('failed');
      expect(failed.completedChunks).toBe(1);
      expect(failed.batchId).toBeNull();
      expect(await prisma.change.count({ where: { worldId } })).toBe(0);
      expect(
        (await prisma.chapter.findUniqueOrThrow({ where: { id: manuscript.chapters[0].id } }))
          .status
      ).toBe('draft');
      expect(
        (await prisma.source.findUniqueOrThrow({ where: { id: failed.sourceId! } })).status
      ).toBe('staged');
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS worldloom_issue12_reject_final ON chapters'
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION worldloom_issue12_reject_final()');
    }
    await resumeCompileRun(worldId, created.run.id);
    const runner = scriptedChat();
    const completed = await executeCompileRun(created.run.id, runner);
    expect(completed.status).toBe('completed');
    expect(runner.calls()).toBe(0);
    expect(
      await prisma.change.count({
        where: { worldId, status: 'pending', batchId: completed.batchId }
      })
    ).toBe(5);
    expect(await prisma.worldVersion.count({ where: { worldId } })).toBe(1);
  });

  it('keeps compiler output pending even for a legacy auto-ingest world', async () => {
    await prisma.world.update({ where: { id: worldId }, data: { ingestMode: 'auto' } });
    const created = await createCompileRun(worldId, {
      kind: 'source',
      sourceFilename: '待审.txt',
      sourceContent: '待审测试'
    });
    const completed = await executeCompileRun(created.run.id, scriptedChat());
    expect(completed.status).toBe('completed');
    expect(await prisma.change.count({ where: { worldId, status: 'pending' } })).toBe(5);
    expect((await prisma.world.findUniqueOrThrow({ where: { id: worldId } })).masterVersion).toBe(
      1
    );
    expect(await prisma.worldVersion.count({ where: { worldId } })).toBe(1);
  });

  it('stops after a provider response exceeds the estimated-cost threshold', async () => {
    const names = [
      'WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN',
      'WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN',
      'WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN'
    ] as const;
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      process.env.WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN = '100';
      process.env.WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN = '100';
      process.env.WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN = '0.000001';
      const created = await createCompileRun(worldId, {
        kind: 'source',
        sourceFilename: '费用门禁.md',
        sourceContent: '预算测试素材'
      });
      let calls = 0;
      const runner: ChatFn = async () => {
        calls += 1;
        return {
          content: ANALYSIS,
          profileId: 'deepseek-official',
          model: 'deepseek-flash',
          usage: { inputTokens: 10, outputTokens: 10 },
          latencyMs: 1
        };
      };

      const failed = await executeCompileRun(created.run.id, runner);
      expect(failed.status).toBe('failed');
      expect(failed.error).toContain('estimated cost');
      expect(calls).toBe(1);
      expect(failed.chunks[0]?.analysisMeta).toBeNull();
      expect(await prisma.change.count({ where: { worldId } })).toBe(0);
    } finally {
      for (const name of names) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
    }
  });

  it('fails closed on incomplete usage before issuing the next provider call', async () => {
    const names = [
      'WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN',
      'WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN',
      'WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN'
    ] as const;
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      process.env.WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN = '100';
      process.env.WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN = '100';
      process.env.WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN = '1';
      const created = await createCompileRun(worldId, {
        kind: 'source',
        sourceFilename: '用量缺失.md',
        sourceContent: '用量完整性测试'
      });
      let calls = 0;
      const runner: ChatFn = async () => {
        calls += 1;
        return {
          content: ANALYSIS,
          profileId: 'deepseek-official',
          model: 'deepseek-flash',
          usage: null,
          latencyMs: 1
        };
      };

      const failed = await executeCompileRun(created.run.id, runner);
      expect(failed.status).toBe('failed');
      expect(failed.error).toContain('provider usage is incomplete');
      expect(calls).toBe(1);
      expect(await prisma.change.count({ where: { worldId } })).toBe(0);
    } finally {
      for (const name of names) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
    }
  });

  it('fails instead of staging against a newer world version', async () => {
    const created = await createCompileRun(worldId, {
      kind: 'source',
      sourceFilename: '过期.md',
      sourceContent: '丙'
    });
    await submitChange(worldId, { kind: 'epoch_upsert', payload: { name: '新纪', order: 0 } });
    await mergeWorld(worldId, 'advance before compile');

    const result = await executeCompileRun(created.run.id, scriptedChat());
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/World advanced/);
    expect(
      await prisma.change.count({ where: { worldId, status: 'pending', author: 'world-compiler' } })
    ).toBe(0);
  });

  it('chapter runs only become final after the durable run completes', async () => {
    const manuscript = await createManuscript(worldId, {
      title: '测试作品',
      chapters: [{ title: '第一章', content: '丁'.repeat(1_200) }]
    });
    const chapter = manuscript.chapters[0];
    const created = await createChapterCompileRun(worldId, manuscript.id, chapter.id);
    expect((await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } })).status).toBe(
      'draft'
    );

    const completed = await executeCompileRun(created.run.id, scriptedChat());
    expect(completed.status).toBe('completed');
    expect((await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } })).status).toBe(
      'final'
    );
  });

  it('requeues a stale worker and resumes from the durable checkpoint', async () => {
    const source = await prisma.source.create({
      data: {
        worldId,
        uid: 'src_stale_run',
        filename: '陈旧任务.md',
        content: '戊'.repeat(1_200),
        contentHash: 'stale-run-hash',
        sizeBytes: 1_200
      }
    });
    const created = await createCompileRun(worldId, {
      kind: 'source',
      sourceId: source.id,
      sourceFilename: source.filename,
      sourceContent: source.content
    });
    const now = new Date('2026-09-22T10:00:00.000Z');
    const firstChunk = created.run.chunks[0];
    await prisma.compileRun.update({
      where: { id: created.run.id },
      data: {
        status: 'running',
        attempts: 1,
        startedAt: new Date(now.getTime() - COMPILE_RUN_STALE_AFTER_MS - 1_000),
        lastHeartbeatAt: new Date(now.getTime() - COMPILE_RUN_STALE_AFTER_MS - 1_000),
        completedChunks: 1
      }
    });
    await prisma.compileChunk.update({
      where: { id: firstChunk.id },
      data: {
        status: 'completed',
        analysis: JSON.parse(ANALYSIS),
        generated: JSON.parse(GENERATED),
        completedAt: new Date(now.getTime() - COMPILE_RUN_STALE_AFTER_MS - 1_000)
      }
    });

    const recovered = await recoverStaleCompileRun(worldId, created.run.id, now);
    expect(recovered.status).toBe('queued');
    expect(recovered.recoveryAttempts).toBe(1);
    expect(recovered.error).toContain('heartbeat expired');
    expect(recovered.chunks.map((chunk) => chunk.status)).toEqual(['completed', 'pending']);

    const chat = scriptedChat();
    const completed = await executeCompileRun(created.run.id, chat);
    expect(completed.status).toBe('completed');
    expect(chat.calls()).toBe(2);
    expect(completed.lastHeartbeatAt).not.toBeNull();
  });

  it('fails a stale compile run after the automatic recovery budget is exhausted', async () => {
    const created = await createCompileRun(worldId, {
      kind: 'source',
      sourceFilename: '恢复耗尽.md',
      sourceContent: '庚'
    });
    const now = new Date('2026-09-24T10:00:00.000Z');
    await prisma.compileRun.update({
      where: { id: created.run.id },
      data: {
        status: 'running',
        recoveryAttempts: MAX_AUTOMATIC_WORKER_RECOVERIES,
        lastHeartbeatAt: new Date(now.getTime() - COMPILE_RUN_STALE_AFTER_MS - 1_000)
      }
    });
    await prisma.compileChunk.updateMany({
      where: { runId: created.run.id },
      data: { status: 'analyzing' }
    });

    const failed = await recoverStaleCompileRun(worldId, created.run.id, now);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('recovery limit reached');
    expect(failed.chunks[0]?.status).toBe('failed');

    const resumed = await resumeCompileRun(worldId, created.run.id);
    expect(resumed.status).toBe('queued');
    expect(resumed.recoveryAttempts).toBe(0);
    expect(resumed.attempts).toBe(failed.attempts);
  });

  it('does not reclaim a worker with a fresh heartbeat', async () => {
    const created = await createCompileRun(worldId, {
      kind: 'source',
      sourceFilename: '活跃任务.md',
      sourceContent: '己'
    });
    const now = new Date('2026-09-22T10:00:00.000Z');
    await prisma.compileRun.update({
      where: { id: created.run.id },
      data: {
        status: 'running',
        lastHeartbeatAt: new Date(now.getTime() - COMPILE_RUN_STALE_AFTER_MS + 1_000)
      }
    });

    const active = await recoverStaleCompileRun(worldId, created.run.id, now);
    expect(active.status).toBe('running');
  });
});
