import { createHash } from 'node:crypto';
import { CompileChunkStatus, CompileRunStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { newUid } from '@/lib/uid';
import { GovernanceError, requireWorld } from '@/lib/governance/changes';
import { chat as defaultChat } from '@/lib/llm/client';
import { getProfileLimits, getProfilePricing } from '@/lib/llm/config';
import {
  analyzeCompileChunkWithMeta,
  COMPILE_PROMPT_VERSION,
  generateCompileChunkWithMeta,
  mergeAnalyses,
  mergeGeneratedWorlds,
  splitForCompile,
  type ChatFn,
  type CompileContext
} from './genesis';
import type { GeneratedWorld } from './contracts';
import { stageGeneratedWorld, type CompileProvenance } from './stager';

type PersistedCompileContext = Omit<CompileContext, 'sourceContent'>;

export type CompileRunInput = {
  kind: 'source' | 'chapter';
  sourceId?: string;
  chapterId?: string;
  sourceFilename: string;
  sourceContent: string;
  context: PersistedCompileContext;
};

function provenanceKey(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function callMetaFallback(profileId: string | null, model: string | null, chunkIndex: number) {
  return {
    chunkIndex,
    profileId: profileId ?? 'unknown',
    model: model ?? 'unknown',
    latencyMs: 0,
    usage: null
  };
}

function addUnique<T>(values: T[], additions: T[], key = (value: T) => JSON.stringify(value)) {
  const seen = new Set(values.map(key));
  for (const addition of additions) {
    const id = key(addition);
    if (!seen.has(id)) {
      seen.add(id);
      values.push(addition);
    }
  }
}

function buildProvenanceLookup(
  run: CompileRunWithChunks,
  sourceUid: string
): Map<string, CompileProvenance> {
  const lookup = new Map<string, CompileProvenance>();
  for (const chunk of run.chunks) {
    const generated = chunk.generated as unknown as GeneratedWorld | null;
    if (!generated) continue;
    const analysis =
      (chunk.analysisMeta as CompileProvenance['analysis'][number] | null) ??
      callMetaFallback(run.profileId, run.model, chunk.index);
    const generation =
      (chunk.generationMeta as CompileProvenance['generation'][number] | null) ??
      callMetaFallback(run.profileId, run.model, chunk.index);
    const base: CompileProvenance = {
      runId: run.id,
      sourceUid,
      sourceHash: run.sourceHash,
      chunkIndexes: [chunk.index],
      chunkHashes: [chunk.contentHash],
      sourceRanges: [
        {
          chunkIndex: chunk.index,
          start: chunk.sourceStart,
          end: chunk.sourceEnd,
          hash: chunk.contentHash
        }
      ],
      promptVersion: run.promptVersion || COMPILE_PROMPT_VERSION,
      analysis: [analysis],
      generation: [generation]
    };
    const add = (kind: string, name: string) => {
      const key = `${kind}:${provenanceKey(name)}`;
      const existing = lookup.get(key);
      if (!existing) {
        lookup.set(key, structuredClone(base));
        return;
      }
      addUnique(existing.chunkIndexes, base.chunkIndexes);
      addUnique(existing.chunkHashes, base.chunkHashes);
      addUnique(
        existing.sourceRanges,
        base.sourceRanges,
        (value) => `${value.chunkIndex}:${value.hash}`
      );
      addUnique(existing.analysis, base.analysis, (value) => `${value.chunkIndex}`);
      addUnique(existing.generation, base.generation, (value) => `${value.chunkIndex}`);
    };
    for (const epoch of generated.epochs) add('epoch', epoch.name);
    for (const entity of generated.entities) add('entity', entity.name);
    for (const event of generated.events) add('event', event.title);
    for (const relation of generated.relations) {
      add('relation', `${relation.subject}|${relation.object}|${relation.relation}`);
    }
  }
  return lookup;
}

type CompileRunWithChunks = Prisma.CompileRunGetPayload<{
  include: { chunks: { orderBy: { index: 'asc' } } };
}>;

/** Provider calls are bounded at 60s; leave enough room before reclaiming a worker. */
export const COMPILE_RUN_HEARTBEAT_INTERVAL_MS = 5_000;
export const COMPILE_RUN_STALE_AFTER_MS = 120_000;

async function heartbeatCompileRun(runId: string) {
  await prisma.compileRun.updateMany({
    where: { id: runId, status: CompileRunStatus.running },
    data: { lastHeartbeatAt: new Date() }
  });
}

function startCompileHeartbeat(runId: string) {
  const timer = setInterval(() => {
    void heartbeatCompileRun(runId).catch(() => {
      // A later beat or the runner's DB operation will surface a real failure.
    });
  }, COMPILE_RUN_HEARTBEAT_INTERVAL_MS);
  void heartbeatCompileRun(runId).catch(() => undefined);
  return () => clearInterval(timer);
}

export async function createCompileRun(worldId: string, input: CompileRunInput) {
  const world = await requireWorld(worldId);
  const sourceHash = createHash('sha256').update(input.sourceContent).digest('hex');
  const chunks = splitForCompile(input.sourceContent);
  const source = input.sourceId
    ? await prisma.source.findFirst({ where: { id: input.sourceId, worldId } })
    : await prisma.source.upsert({
        where: { worldId_contentHash: { worldId, contentHash: sourceHash } },
        update: {},
        create: {
          worldId,
          uid: newUid('src'),
          filename: input.sourceFilename.slice(0, 200),
          mediaType: 'text/markdown',
          content: input.sourceContent,
          contentHash: sourceHash,
          sizeBytes: Buffer.byteLength(input.sourceContent, 'utf8'),
          author: input.kind === 'chapter' ? 'chapter-compiler' : 'compile-run'
        }
      });
  if (!source) throw new GovernanceError('source_not_found', 'Compile source not found');
  const sourceId = source.id;

  const existing = await prisma.compileRun.findFirst({
    where: {
      worldId,
      kind: input.kind,
      sourceHash,
      baseVersion: world.masterVersion,
      status: { in: [CompileRunStatus.queued, CompileRunStatus.running] },
      sourceId,
      ...(input.chapterId ? { chapterId: input.chapterId } : {})
    },
    include: { chunks: { orderBy: { index: 'asc' } } },
    orderBy: { createdAt: 'desc' }
  });
  if (existing) return { run: existing, reused: true };

  const run = await prisma.compileRun.create({
    data: {
      worldId,
      kind: input.kind,
      sourceId,
      chapterId: input.chapterId ?? null,
      sourceHash,
      sourceFilename: input.sourceFilename,
      context: input.context as Prisma.InputJsonValue,
      baseVersion: world.masterVersion,
      totalChunks: chunks.length,
      chunks: {
        create: chunks.map((content, index) => {
          const sourceStart = chunks
            .slice(0, index)
            .reduce((offset, previous) => offset + previous.length, 0);
          return {
            index,
            sourceStart,
            sourceEnd: sourceStart + content.length,
            content,
            contentHash: createHash('sha256').update(content).digest('hex')
          };
        })
      }
    },
    include: { chunks: { orderBy: { index: 'asc' } } }
  });
  return { run, reused: false };
}

async function loadRun(runId: string): Promise<CompileRunWithChunks> {
  const run = await prisma.compileRun.findUnique({
    where: { id: runId },
    include: { chunks: { orderBy: { index: 'asc' } } }
  });
  if (!run) throw new GovernanceError('compile_run_not_found', 'Compile run not found');
  return run;
}

type PersistedCallMeta = {
  latencyMs?: unknown;
  usage?: unknown;
};

function persistedCallMeta(value: unknown): PersistedCallMeta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as PersistedCallMeta;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function profileLimits(profileId: string | null) {
  if (!profileId) return null;
  try {
    return getProfileLimits(profileId);
  } catch {
    return null;
  }
}

/** Enforce configured per-run budgets before the next model result is staged. */
function enforceCompileBudget(
  run: CompileRunWithChunks,
  profileId: string,
  extraMeta: PersistedCallMeta
) {
  const limits = profileLimits(profileId);
  if (!limits) return;
  const metas = [
    ...run.chunks.flatMap((chunk) => [chunk.analysisMeta, chunk.generationMeta]),
    extraMeta
  ]
    .map(persistedCallMeta)
    .filter((meta): meta is PersistedCallMeta => meta !== null);
  let inputTokens = 0;
  let outputTokens = 0;
  let usageCalls = 0;
  for (const meta of metas) {
    if (!meta.usage || typeof meta.usage !== 'object' || Array.isArray(meta.usage)) continue;
    const usage = meta.usage as { inputTokens?: unknown; outputTokens?: unknown };
    const input = nonNegativeNumber(usage.inputTokens);
    const output = nonNegativeNumber(usage.outputTokens);
    if (input === null || output === null) continue;
    inputTokens += input;
    outputTokens += output;
    usageCalls += 1;
  }
  const violations: string[] = [];
  const budgetConfigured =
    limits.maxInputTokensPerRun !== null ||
    limits.maxOutputTokensPerRun !== null ||
    limits.maxEstimatedCostUsdPerRun !== null;
  if (budgetConfigured && usageCalls < metas.length) {
    violations.push('provider usage is incomplete; configured budget cannot be verified');
  }
  if (limits.maxInputTokensPerRun !== null && inputTokens > limits.maxInputTokensPerRun) {
    violations.push(`input tokens ${inputTokens} > ${limits.maxInputTokensPerRun}`);
  }
  if (limits.maxOutputTokensPerRun !== null && outputTokens > limits.maxOutputTokensPerRun) {
    violations.push(`output tokens ${outputTokens} > ${limits.maxOutputTokensPerRun}`);
  }
  if (limits.maxEstimatedCostUsdPerRun !== null) {
    let pricing: ReturnType<typeof getProfilePricing> = null;
    try {
      pricing = getProfilePricing(profileId);
    } catch {
      pricing = null;
    }
    if (!pricing) {
      violations.push('cost cap requires a configured pricing table');
    } else if (usageCalls > 0) {
      const estimatedCostUsd =
        (inputTokens / 1_000_000) * pricing.inputUsdPerMillion +
        (outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
      if (estimatedCostUsd > limits.maxEstimatedCostUsdPerRun) {
        violations.push(
          `estimated cost ${estimatedCostUsd.toFixed(8)} > ${limits.maxEstimatedCostUsdPerRun}`
        );
      }
    }
  }
  if (violations.length > 0) {
    throw new GovernanceError(
      'compile_budget_exceeded',
      `Compile run budget exceeded: ${violations.join('; ')}`,
      { profileId, inputTokens, outputTokens, limits }
    );
  }
}

export function compileRunUsageSummary(run: CompileRunWithChunks) {
  const metas = run.chunks.flatMap((chunk) => [
    persistedCallMeta(chunk.analysisMeta),
    persistedCallMeta(chunk.generationMeta)
  ]);
  const observedCalls = metas.filter((meta): meta is PersistedCallMeta => meta !== null);
  let usageCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let latencyMs = 0;
  let latencySamples = 0;
  for (const meta of observedCalls) {
    const latency = nonNegativeNumber(meta.latencyMs);
    if (latency !== null) {
      latencyMs += latency;
      latencySamples += 1;
    }
    if (!meta.usage || typeof meta.usage !== 'object' || Array.isArray(meta.usage)) continue;
    const usage = meta.usage as { inputTokens?: unknown; outputTokens?: unknown };
    const input = nonNegativeNumber(usage.inputTokens);
    const output = nonNegativeNumber(usage.outputTokens);
    if (input === null || output === null) continue;
    usageCalls += 1;
    inputTokens += input;
    outputTokens += output;
  }
  const expectedCalls = run.totalChunks * 2;
  let pricing: ReturnType<typeof getProfilePricing> = null;
  if (run.profileId) {
    try {
      pricing = getProfilePricing(run.profileId);
    } catch {
      pricing = null;
    }
  }
  const limits = profileLimits(run.profileId);
  const estimatedCostUsd =
    pricing && usageCalls
      ? Number(
          (
            (inputTokens / 1_000_000) * pricing.inputUsdPerMillion +
            (outputTokens / 1_000_000) * pricing.outputUsdPerMillion
          ).toFixed(8)
        )
      : null;
  return {
    expectedCalls,
    observedCalls: observedCalls.length,
    usageCalls,
    usageCoverage: expectedCalls ? Number((usageCalls / expectedCalls).toFixed(4)) : 0,
    usageComplete: run.status === 'completed' && usageCalls === expectedCalls,
    inputTokens: usageCalls ? inputTokens : null,
    outputTokens: usageCalls ? outputTokens : null,
    totalTokens: usageCalls ? inputTokens + outputTokens : null,
    latencyMs: latencySamples ? latencyMs : null,
    latencySamples,
    pricingConfigured: pricing !== null,
    estimatedCostUsd,
    limits
  };
}

export async function getCompileRun(worldId: string, runId: string) {
  const run = await loadRun(runId);
  if (run.worldId !== worldId) {
    throw new GovernanceError('compile_run_not_found', 'Compile run not found');
  }
  return run;
}

export function compileRunSummary(run: CompileRunWithChunks) {
  return {
    id: run.id,
    worldId: run.worldId,
    kind: run.kind,
    sourceId: run.sourceId,
    chapterId: run.chapterId,
    sourceFilename: run.sourceFilename,
    promptVersion: run.promptVersion,
    profileId: run.profileId,
    model: run.model,
    baseVersion: run.baseVersion,
    totalChunks: run.totalChunks,
    completedChunks: run.completedChunks,
    status: run.status,
    batchId: run.batchId,
    result: run.result,
    error: run.error,
    attempts: run.attempts,
    startedAt: run.startedAt,
    lastHeartbeatAt: run.lastHeartbeatAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    usage: compileRunUsageSummary(run),
    chunks: run.chunks.map((chunk) => ({
      index: chunk.index,
      sourceStart: chunk.sourceStart,
      sourceEnd: chunk.sourceEnd,
      contentHash: chunk.contentHash,
      status: chunk.status,
      attempts: chunk.attempts,
      analysisMeta: chunk.analysisMeta,
      generationMeta: chunk.generationMeta,
      error: chunk.error,
      startedAt: chunk.startedAt,
      completedAt: chunk.completedAt
    }))
  };
}

function asCompileContext(run: CompileRunWithChunks, sourceContent: string): CompileContext {
  return {
    ...(run.context as unknown as PersistedCompileContext),
    sourceContent
  };
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

async function degradeChapter(run: CompileRunWithChunks, reason: string) {
  if (run.kind !== 'chapter' || !run.chapterId) return null;
  const content = run.chunks
    .toSorted((a, b) => a.index - b.index)
    .map((chunk) => chunk.content)
    .join('');
  const contentHash = createHash('sha256').update(content).digest('hex');
  const existingSource = await prisma.source.findUnique({
    where: { worldId_contentHash: { worldId: run.worldId, contentHash } }
  });
  const source =
    existingSource ??
    (await prisma.source.create({
      data: {
        worldId: run.worldId,
        uid: newUid('src'),
        filename: `未编译章节 · ${run.sourceFilename}`.slice(0, 200),
        mediaType: 'text/markdown',
        content,
        contentHash,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        author: 'chapter-degrade',
        status: 'staged'
      }
    }));
  await prisma.chapter.update({ where: { id: run.chapterId }, data: { status: 'draft' } });
  return { degradedSourceId: source.id, reason };
}

async function failRun(runId: string, error: unknown) {
  const run = await loadRun(runId);
  const message = errorMessage(error);
  const degraded = await degradeChapter(run, message);
  const result = degraded ? { failed: true, ...degraded } : { failed: true };
  await prisma.compileRun.update({
    where: { id: runId },
    data: {
      status: CompileRunStatus.failed,
      error: message,
      result: result as Prisma.InputJsonValue,
      finishedAt: new Date()
    }
  });
  return loadRun(runId);
}

async function currentRunStatus(runId: string) {
  return prisma.compileRun.findUnique({ where: { id: runId }, select: { status: true } });
}

async function finishRun(run: CompileRunWithChunks) {
  const world = await prisma.world.findUnique({ where: { id: run.worldId } });
  if (!world) throw new GovernanceError('world_not_found', 'World not found');
  if (world.masterVersion !== run.baseVersion) {
    throw new GovernanceError(
      'compile_stale_world',
      `World advanced from version ${run.baseVersion} to ${world.masterVersion}; compile again`
    );
  }

  const source = run.sourceId
    ? await prisma.source.findUnique({ where: { id: run.sourceId } })
    : null;
  if (!source) throw new GovernanceError('source_not_found', 'Compile source not found');

  const analyses = run.chunks.map((chunk) => chunk.analysis).filter((value) => value !== null);
  const generated = mergeGeneratedWorlds(
    run.chunks.map((chunk) => chunk.generated).filter(Boolean) as unknown as GeneratedWorld[]
  );
  const batchId = run.batchId ?? `bat_compile_${run.id}`;
  if (!run.batchId) {
    await prisma.compileRun.update({ where: { id: run.id }, data: { batchId } });
  }
  const provenance = buildProvenanceLookup(run, source.uid);
  const staged = await stageGeneratedWorld(run.worldId, generated, {
    author: run.kind === 'chapter' ? 'chapter-compiler' : 'world-compiler',
    batchId,
    sourceRefs: [source.uid],
    provenanceFor: (kind, name) => provenance.get(`${kind}:${provenanceKey(name)}`)
  });
  const result = {
    analysis: mergeAnalyses(analyses),
    staged: staged.staged,
    defects: staged.defects,
    batchId: staged.batchId,
    chunks: run.totalChunks
  };

  await prisma.$transaction(async (tx) => {
    await tx.compileRun.update({
      where: { id: run.id },
      data: {
        status: CompileRunStatus.completed,
        completedChunks: run.totalChunks,
        result: result as Prisma.InputJsonValue,
        error: null,
        finishedAt: new Date()
      }
    });
    if (run.sourceId) {
      await tx.source.update({ where: { id: run.sourceId }, data: { status: 'compiled' } });
    }
    if (run.chapterId) {
      await tx.chapter.update({
        where: { id: run.chapterId },
        data: { status: 'final', finalAt: new Date() }
      });
    }
  });
  return loadRun(run.id);
}

/** Execute a queued run. The caller may fire this without awaiting it. */
export async function executeCompileRun(runId: string, runner: ChatFn = defaultChat) {
  const claimed = await prisma.compileRun.updateMany({
    where: { id: runId, status: { in: [CompileRunStatus.queued, CompileRunStatus.failed] } },
    data: {
      status: CompileRunStatus.running,
      attempts: { increment: 1 },
      error: null,
      finishedAt: null,
      startedAt: new Date(),
      lastHeartbeatAt: new Date()
    }
  });
  if (claimed.count === 0) return loadRun(runId);

  const stopHeartbeat = startCompileHeartbeat(runId);
  try {
    await prisma.compileChunk.updateMany({
      where: {
        runId,
        status: {
          in: [
            CompileChunkStatus.failed,
            CompileChunkStatus.analyzing,
            CompileChunkStatus.generating
          ]
        }
      },
      data: { status: CompileChunkStatus.pending, error: null, startedAt: null }
    });

    while (true) {
      const run = await loadRun(runId);
      if (run.status === CompileRunStatus.cancelled) return run;
      const chunk = run.chunks.find((item) => item.status === CompileChunkStatus.pending);
      if (!chunk) return await finishRun(run);

      const chunkClaimed = await prisma.compileChunk.updateMany({
        where: { id: chunk.id, status: CompileChunkStatus.pending },
        data: {
          status: CompileChunkStatus.analyzing,
          attempts: { increment: 1 },
          error: null,
          startedAt: new Date(),
          completedAt: null
        }
      });
      if (chunkClaimed.count === 0) continue;

      const context = asCompileContext(run, chunk.content);
      const analysisResult = await analyzeCompileChunkWithMeta(runner, context, chunk.content);
      const afterAnalysis = await currentRunStatus(runId);
      if (!afterAnalysis || afterAnalysis.status === CompileRunStatus.cancelled)
        return loadRun(runId);
      await prisma.compileRun.update({
        where: { id: runId },
        data: { profileId: analysisResult.meta.profileId, model: analysisResult.meta.model }
      });
      enforceCompileBudget(run, analysisResult.meta.profileId, analysisResult.meta);
      await prisma.compileChunk.update({
        where: { id: chunk.id },
        data: {
          status: CompileChunkStatus.generating,
          analysis: analysisResult.analysis as Prisma.InputJsonValue,
          analysisMeta: {
            ...analysisResult.meta,
            chunkIndex: chunk.index
          } as Prisma.InputJsonValue
        }
      });

      const generatedResult = await generateCompileChunkWithMeta(
        runner,
        context,
        chunk.content,
        analysisResult.analysis
      );
      enforceCompileBudget(
        await loadRun(runId),
        generatedResult.meta.profileId,
        generatedResult.meta
      );
      await prisma.compileChunk.update({
        where: { id: chunk.id },
        data: {
          status: CompileChunkStatus.completed,
          generated: generatedResult.generated as unknown as Prisma.InputJsonValue,
          generationMeta: {
            ...generatedResult.meta,
            chunkIndex: chunk.index
          } as Prisma.InputJsonValue,
          error: null,
          completedAt: new Date()
        }
      });
      const completedChunks = await prisma.compileChunk.count({
        where: { runId, status: CompileChunkStatus.completed }
      });
      await prisma.compileRun.update({ where: { id: runId }, data: { completedChunks } });
    }
  } catch (error) {
    await prisma.compileChunk.updateMany({
      where: {
        runId,
        status: { in: [CompileChunkStatus.analyzing, CompileChunkStatus.generating] }
      },
      data: { status: CompileChunkStatus.failed, error: errorMessage(error) }
    });
    return failRun(runId, error);
  } finally {
    stopHeartbeat();
  }
}

/**
 * Re-queue a run whose worker stopped heartbeating. The compare-and-set keeps
 * two status requests from reclaiming the same live run concurrently.
 */
export async function recoverStaleCompileRun(worldId: string, runId: string, now = new Date()) {
  const run = await getCompileRun(worldId, runId);
  if (run.status !== CompileRunStatus.running) return run;

  const staleBefore = new Date(now.getTime() - COMPILE_RUN_STALE_AFTER_MS);
  await prisma.compileRun.updateMany({
    where: {
      id: runId,
      worldId,
      status: CompileRunStatus.running,
      OR: [{ lastHeartbeatAt: null }, { lastHeartbeatAt: { lt: staleBefore } }]
    },
    data: {
      status: CompileRunStatus.queued,
      error: 'Worker heartbeat expired; queued for recovery',
      startedAt: null,
      finishedAt: null,
      lastHeartbeatAt: null
    }
  });
  return getCompileRun(worldId, runId);
}

export async function resumeCompileRun(worldId: string, runId: string) {
  const run = await getCompileRun(worldId, runId);
  if (run.status === CompileRunStatus.completed) {
    throw new GovernanceError('compile_run_completed', 'Compile run is already completed');
  }
  if (run.status === CompileRunStatus.running) {
    throw new GovernanceError('compile_run_active', 'Compile run is still active');
  }
  await prisma.$transaction([
    prisma.compileRun.update({
      where: { id: runId },
      data: {
        status: CompileRunStatus.queued,
        error: null,
        startedAt: null,
        finishedAt: null,
        lastHeartbeatAt: null
      }
    }),
    prisma.compileChunk.updateMany({
      where: {
        runId,
        status: {
          in: [
            CompileChunkStatus.failed,
            CompileChunkStatus.analyzing,
            CompileChunkStatus.generating
          ]
        }
      },
      data: { status: CompileChunkStatus.pending, error: null, startedAt: null }
    })
  ]);
  return getCompileRun(worldId, runId);
}

export async function cancelCompileRun(worldId: string, runId: string) {
  await getCompileRun(worldId, runId);
  await prisma.compileRun.updateMany({
    where: {
      id: runId,
      status: { in: [CompileRunStatus.queued, CompileRunStatus.running] }
    },
    data: { status: CompileRunStatus.cancelled, finishedAt: new Date(), error: 'Cancelled by user' }
  });
  return getCompileRun(worldId, runId);
}
