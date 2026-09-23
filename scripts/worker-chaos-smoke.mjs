#!/usr/bin/env node
/**
 * Controlled local Compose fault-injection check for the independent worker.
 *
 * It queues a deliberately non-trivial semantic job, waits until the worker
 * has claimed it, kills the worker container, lets Compose restart it, and
 * verifies stale-lease recovery plus idempotent vector persistence.
 *
 * Usage: pnpm worker:chaos-smoke [--timeout-ms=300000] [--entities=512]
 * This is an E2 local/isolated-environment drill, not production evidence.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const timeoutMs = readBoundedNumber('--timeout-ms', 300_000, 150_000, 600_000);
const entityCount = readBoundedNumber('--entities', 512, 64, 5_000);
const pollMs = 2_000;

function readBoundedNumber(name, fallback, minimum, maximum) {
  const prefix = `${name}=`;
  const raw = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function docker(argumentsList, { allowFailure = false } = {}) {
  try {
    const result = await execFileAsync('docker', argumentsList, { maxBuffer: 2 * 1024 * 1024 });
    return result.stdout.trim();
  } catch (error) {
    if (allowFailure) return '';
    const stderr = error?.stderr?.trim();
    throw new Error(stderr || `docker ${argumentsList.join(' ')} failed`);
  }
}

async function workerRuntimeIdentity() {
  const value = await docker([
    'inspect',
    '--format',
    '{{.Id}}|{{.State.StartedAt}}|{{.RestartCount}}',
    'worldloom-worker'
  ]);
  const [id, startedAt, restartCountText] = value.split('|');
  const restartCount = Number.parseInt(restartCountText, 10);
  if (!id || !startedAt || !Number.isInteger(restartCount)) {
    throw new Error(`invalid worker runtime identity: ${value}`);
  }
  return { id, startedAt, restartCount };
}

async function waitForJob(prisma, jobId, predicate, deadline) {
  let observed = null;
  while (Date.now() < deadline) {
    observed = await prisma.semanticIndexJob.findUnique({ where: { id: jobId } });
    if (predicate(observed)) return observed;
    await sleep(pollMs);
  }
  return observed;
}

async function main() {
  const prisma = new PrismaClient({ log: ['error'] });
  let worldId;
  let workerWasStarted = false;
  let killedAt = null;
  try {
    const workerContainer = await docker(['compose', '--profile', 'full', 'ps', '-q', 'worker']);
    if (!workerContainer) {
      throw new Error(
        'worldloom-worker is not present; start the isolated stack with `docker compose --profile full up -d --build` first'
      );
    }
    const runtimeBefore = await workerRuntimeIdentity();

    const world = await prisma.world.create({
      data: {
        name: `WorldLoom-worker-chaos-${Date.now()}`,
        premise: '独立 worker kill/restart fault-injection 临时世界'
      },
      select: { id: true }
    });
    worldId = world.id;

    await prisma.entity.createMany({
      data: Array.from({ length: entityCount }, (_, index) => ({
        worldId,
        version: 1,
        uid: `worker_chaos_entity_${index}`,
        kind: 'concept',
        name: `Worker Chaos Entity ${index}`,
        summary: `Fault injection fixture ${index} with deterministic content.`,
        content:
          'This temporary entity exists to keep semantic indexing active while the worker container is restarted. '
          + `Fixture sequence ${index} repeats the recovery contract without user data.`
      }))
    });

    const job = await prisma.semanticIndexJob.create({
      data: { worldId, version: 1, status: 'queued' },
      select: { id: true }
    });
    const claimDeadline = Date.now() + Math.min(timeoutMs, 60_000);
    const claimed = await waitForJob(
      prisma,
      job.id,
      (value) => value?.status === 'running' || value?.status === 'failed' || value?.status === 'completed',
      claimDeadline
    );
    if (!claimed || claimed.status !== 'running') {
      throw new Error(
        `worker did not enter running state: status=${claimed?.status ?? 'timeout'} error=${claimed?.error ?? 'none'}`
      );
    }

    const attemptsBeforeKill = claimed.attempts;
    const heartbeatBeforeKill = claimed.lastHeartbeatAt?.toISOString() ?? null;
    await docker(['kill', '--signal=SIGKILL', 'worldloom-worker']);
    killedAt = new Date().toISOString();
    await docker(['compose', '--profile', 'full', 'up', '-d', 'worker']);
    workerWasStarted = true;

    const recoveryDeadline = Date.now() + timeoutMs;
    const recovered = await waitForJob(
      prisma,
      job.id,
      (value) => value?.status === 'completed' || value?.status === 'failed',
      recoveryDeadline
    );
    const runtimeAfter = await workerRuntimeIdentity();
    const runtimeChanged =
      runtimeBefore.id !== runtimeAfter.id || runtimeBefore.startedAt !== runtimeAfter.startedAt;
    const vectorCount = await prisma.$queryRaw`
      SELECT count(*)::int AS count
      FROM semantic_vectors
      WHERE "worldId" = ${worldId} AND version = 1
    `;
    const vectors = Number(vectorCount[0]?.count ?? 0);
    if (
      recovered?.status !== 'completed' ||
      recovered.attempts <= attemptsBeforeKill ||
      recovered.indexed !== entityCount ||
      vectors !== entityCount ||
      !runtimeChanged
    ) {
      throw new Error(
        `worker chaos contract failed: status=${recovered?.status ?? 'timeout'} `
          + `attempts=${recovered?.attempts ?? 0} indexed=${recovered?.indexed ?? 0} `
          + `vectors=${vectors} runtimeChanged=${runtimeChanged} `
          + `restarts=${runtimeBefore.restartCount}->${runtimeAfter.restartCount} `
          + `error=${recovered?.error ?? 'none'}`
      );
    }
    console.log(
      JSON.stringify(
        {
          passed: true,
          scenario: 'worker-kill-restart-stale-lease-recovery',
          entityCount,
          jobId: job.id,
          heartbeatBeforeKill,
          killedAt,
          attempts: `${attemptsBeforeKill}->${recovered.attempts}`,
          indexed: recovered.indexed,
          vectors,
          workerRuntime: {
            idChanged: runtimeBefore.id !== runtimeAfter.id,
            startedAt: `${runtimeBefore.startedAt}->${runtimeAfter.startedAt}`,
            restartCount: `${runtimeBefore.restartCount}->${runtimeAfter.restartCount}`
          },
          cleanup: 'temporary world deleted in finally'
        },
        null,
        2
      )
    );
  } finally {
    if (worldId) await prisma.world.delete({ where: { id: worldId } }).catch(() => undefined);
    await prisma.$disconnect();
    if (workerWasStarted) await docker(['compose', '--profile', 'full', 'up', '-d', 'worker'], { allowFailure: true });
  }
}

main().catch((error) => {
  console.error(`worker chaos smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
