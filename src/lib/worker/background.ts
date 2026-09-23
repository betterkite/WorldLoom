import { CompileRunStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import {
  COMPILE_RUN_STALE_AFTER_MS,
  executeCompileRun,
  recoverStaleCompileRun
} from '@/lib/worldbuilding/compile-run';
import { runSemanticIndexJob, SEMANTIC_JOB_STALE_MS } from '@/lib/retrieval/search';

export const WORKER_POLL_INTERVAL_MS = 5_000;
const WORKER_BATCH_SIZE = 4;
const DEFAULT_WORKER_MAX_CONCURRENCY = 4;

export function getWorkerMaxConcurrency(
  env: Record<string, string | undefined> = process.env
): number {
  const configured = Number.parseInt(env.WORLDLOOM_WORKER_MAX_CONCURRENCY ?? '', 10);
  if (!Number.isInteger(configured) || configured < 1) return DEFAULT_WORKER_MAX_CONCURRENCY;
  return Math.min(configured, 32);
}

export const WORKER_MAX_CONCURRENCY = getWorkerMaxConcurrency();

type WorkerGlobal = typeof globalThis & {
  worldloomBackgroundWorker?: ReturnType<typeof setInterval>;
  worldloomBackgroundTick?: Promise<WorkerTickResult>;
  worldloomActiveTasks?: number;
};

const workerGlobal = globalThis as WorkerGlobal;

type WorkerTickResult = {
  recoveredCompileRuns: number;
  startedCompileRuns: number;
  startedSemanticJobs: number;
  activeTasks: number;
};

function staleBefore(now: Date, timeoutMs: number) {
  return new Date(now.getTime() - timeoutMs);
}

/**
 * One DB-backed worker tick. Every executor still performs its own
 * compare-and-set claim, so API-triggered and worker-triggered execution may
 * safely overlap during deployment transitions.
 */
async function runWorkerTickInternal(now: Date): Promise<WorkerTickResult> {
  const activeTasks = workerGlobal.worldloomActiveTasks ?? 0;
  const staleCompileRuns = await prisma.compileRun.findMany({
    where: {
      status: CompileRunStatus.running,
      OR: [
        { lastHeartbeatAt: null },
        { lastHeartbeatAt: { lt: staleBefore(now, COMPILE_RUN_STALE_AFTER_MS) } }
      ]
    },
    select: { id: true, worldId: true },
    take: WORKER_BATCH_SIZE
  });
  for (const run of staleCompileRuns) {
    await recoverStaleCompileRun(run.worldId, run.id, now).catch(() => undefined);
  }

  const compileSlots = Math.max(0, WORKER_MAX_CONCURRENCY - activeTasks);
  const queuedRuns = await prisma.compileRun.findMany({
    where: { status: CompileRunStatus.queued },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
    take: Math.min(WORKER_BATCH_SIZE, compileSlots)
  });
  for (const run of queuedRuns) {
    workerGlobal.worldloomActiveTasks = (workerGlobal.worldloomActiveTasks ?? 0) + 1;
    void executeCompileRun(run.id)
      .catch(() => undefined)
      .finally(() => {
        workerGlobal.worldloomActiveTasks = Math.max(
          0,
          (workerGlobal.worldloomActiveTasks ?? 1) - 1
        );
      });
  }

  const semanticSlots = Math.max(
    0,
    WORKER_MAX_CONCURRENCY - (workerGlobal.worldloomActiveTasks ?? 0)
  );
  const semanticJobs = await prisma.semanticIndexJob.findMany({
    where: {
      OR: [
        { status: 'queued' },
        { status: 'running', lastHeartbeatAt: null },
        { status: 'running', lastHeartbeatAt: { lt: staleBefore(now, SEMANTIC_JOB_STALE_MS) } }
      ]
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
    take: Math.min(WORKER_BATCH_SIZE, semanticSlots)
  });
  for (const job of semanticJobs) {
    workerGlobal.worldloomActiveTasks = (workerGlobal.worldloomActiveTasks ?? 0) + 1;
    void runSemanticIndexJob(job.id)
      .catch(() => undefined)
      .finally(() => {
        workerGlobal.worldloomActiveTasks = Math.max(
          0,
          (workerGlobal.worldloomActiveTasks ?? 1) - 1
        );
      });
  }

  return {
    recoveredCompileRuns: staleCompileRuns.length,
    startedCompileRuns: queuedRuns.length,
    startedSemanticJobs: semanticJobs.length,
    activeTasks: workerGlobal.worldloomActiveTasks ?? 0
  };
}

/** Run one DB poll; overlapping ticks share one in-flight promise. */
export function runWorkerTick(now = new Date()): Promise<WorkerTickResult> {
  if (workerGlobal.worldloomBackgroundTick) return workerGlobal.worldloomBackgroundTick;
  const promise = runWorkerTickInternal(now);
  workerGlobal.worldloomBackgroundTick = promise;
  void promise.then(
    () => {
      if (workerGlobal.worldloomBackgroundTick === promise)
        delete workerGlobal.worldloomBackgroundTick;
    },
    () => {
      if (workerGlobal.worldloomBackgroundTick === promise)
        delete workerGlobal.worldloomBackgroundTick;
    }
  );
  return promise;
}

/** Start one process-local polling loop; safe to call repeatedly in dev/HMR. */
export function startBackgroundWorker() {
  if (workerGlobal.worldloomBackgroundWorker) return;
  void runWorkerTick().catch(() => undefined);
  const timer = setInterval(() => {
    void runWorkerTick().catch(() => undefined);
  }, WORKER_POLL_INTERVAL_MS);
  timer.unref?.();
  workerGlobal.worldloomBackgroundWorker = timer;
}
