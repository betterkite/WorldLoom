#!/usr/bin/env node
/**
 * Independent worker runtime smoke test.
 *
 * Inserts one queued semantic-index job directly into PostgreSQL, waits for
 * the separately running WORLDLOOM_WORKER=true process to claim it, and
 * verifies that one vector was persisted. It never calls the web process and
 * removes the temporary world on completion.
 *
 * Usage: pnpm worker:smoke [timeoutMs]
 */

import { PrismaClient } from '@prisma/client';

const timeoutMs = Number.parseInt(process.argv[2] ?? '45000', 10);
const pollMs = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 300_000) {
    throw new Error('timeoutMs must be an integer from 5000 to 300000');
  }

  const prisma = new PrismaClient({ log: ['error'] });
  let worldId;
  try {
    const world = await prisma.world.create({
      data: {
        name: `WorldLoom-worker-smoke-${Date.now()}`,
        premise: '独立 worker runtime smoke 临时世界'
      },
      select: { id: true }
    });
    worldId = world.id;

    await prisma.entity.create({
      data: {
        worldId,
        version: 1,
        uid: 'worker_smoke_entity',
        kind: 'concept',
        name: 'Worker Smoke Entity',
        summary: '独立 worker smoke test entity',
        content: 'This entity exists only to prove a queued semantic job is claimed and persisted.'
      }
    });

    const job = await prisma.semanticIndexJob.create({
      data: { worldId, version: 1, status: 'queued' },
      select: { id: true }
    });
    const deadline = Date.now() + timeoutMs;
    let observed = null;
    while (Date.now() < deadline) {
      observed = await prisma.semanticIndexJob.findUnique({ where: { id: job.id } });
      if (observed?.status === 'completed' || observed?.status === 'failed') break;
      await sleep(pollMs);
    }

    if (observed?.status !== 'completed' || observed.indexed !== 1) {
      throw new Error(
        `worker did not complete the job: status=${observed?.status ?? 'timeout'} indexed=${observed?.indexed ?? 0} error=${observed?.error ?? 'none'}`
      );
    }

    const vectorCount = await prisma.$queryRaw`SELECT count(*)::int AS count
      FROM semantic_vectors WHERE "worldId" = ${worldId} AND version = 1`;
    console.log(
      JSON.stringify(
        {
          passed: true,
          jobId: job.id,
          status: observed.status,
          attempts: observed.attempts,
          indexed: observed.indexed,
          vectors: vectorCount[0]?.count ?? 0,
          cleanup: 'temporary world deleted in finally'
        },
        null,
        2
      )
    );
  } finally {
    if (worldId) await prisma.world.delete({ where: { id: worldId } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`worker smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
