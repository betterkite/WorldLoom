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

function context() {
  return {
    worldName: '测试世界',
    premise: '测试前提',
    style: '',
    catalog: { epochs: [], entities: [], events: [] },
    sourceFilename: '测试素材.md'
  };
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

describe('durable compiler runs (ISS-31)', () => {
  let worldId: string;

  beforeEach(async () => {
    await cleanDb();
    worldId = (await createWorld({ name: '测试世界', premise: '测试前提' })).id;
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
      sourceContent: source.content,
      context: context()
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

  it('cancelled runs do not call the model or stage changes', async () => {
    const created = await createCompileRun(worldId, {
      kind: 'source',
      sourceFilename: '取消.md',
      sourceContent: '乙'.repeat(1_200),
      context: context()
    });
    await cancelCompileRun(worldId, created.run.id);
    const chat = scriptedChat();
    const cancelled = await executeCompileRun(created.run.id, chat);
    expect(cancelled.status).toBe('cancelled');
    expect(chat.calls()).toBe(0);
    expect(await prisma.change.count({ where: { worldId } })).toBe(0);
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
        sourceContent: '预算测试素材',
        context: context()
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
        sourceContent: '用量完整性测试',
        context: context()
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
      sourceContent: '丙',
      context: context()
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
      sourceContent: source.content,
      context: context()
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
      sourceContent: '庚',
      context: context()
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
      sourceContent: '己',
      context: context()
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
