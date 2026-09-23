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

type WorkerGlobal = typeof globalThis & {
  worldloomBackgroundWorker?: ReturnType<typeof setInterval>;
};

const workerGlobal = globalThis as WorkerGlobal;

function staleBefore(now: Date, timeoutMs: number) {
  return new Date(now.getTime() - timeoutMs);
}

/**
 * One DB-backed worker tick. Every executor still performs its own
 * compare-and-set claim, so API-triggered and worker-triggered execution may
 * safely overlap during deployment transitions.
 */
export async function runWorkerTick(now = new Date()) {
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

  const queuedRuns = await prisma.compileRun.findMany({
    where: { status: CompileRunStatus.queued },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
    take: WORKER_BATCH_SIZE
  });
  for (const run of queuedRuns) {
    void executeCompileRun(run.id).catch(() => undefined);
  }

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
    take: WORKER_BATCH_SIZE
  });
  for (const job of semanticJobs) {
    void runSemanticIndexJob(job.id).catch(() => undefined);
  }

  return {
    recoveredCompileRuns: staleCompileRuns.length,
    startedCompileRuns: queuedRuns.length,
    startedSemanticJobs: semanticJobs.length
  };
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
