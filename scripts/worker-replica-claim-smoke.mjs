#!/usr/bin/env node
/**
 * CI-only probe proving an individual Compose worker replica consumes a
 * durable SemanticIndexJob. The empty fixture intentionally follows the
 * application's safe "no content" terminal path, so this needs no provider,
 * model download, or external network service.
 *
 * The CI orchestrator leaves only the replica under test running while this
 * process creates the probe. It is copied into the app container and run
 * there so it can use the production image's generated Prisma client.
 */

import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const timeoutMs = 45_000;
const pollMs = 250;
const prisma = new PrismaClient({ log: ['error'] });
let worldId;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  try {
    const world = await prisma.world.create({
      data: {
        name: `WorldLoom-worker-replica-probe-${randomUUID()}`,
        premise: 'Temporary empty fixture for isolated worker-replica claim verification.'
      },
      select: { id: true }
    });
    worldId = world.id;

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

    if (
      observed?.status !== 'failed' ||
      observed.attempts !== 1 ||
      observed.recoveryAttempts !== 0 ||
      observed.indexed !== 0 ||
      observed.error !== 'no content' ||
      !observed.startedAt ||
      !observed.finishedAt
    ) {
      throw new Error(
        `replica did not consume the probe: status=${observed?.status ?? 'timeout'} `
          + `attempts=${observed?.attempts ?? 0} error=${observed?.error ?? 'none'}`
      );
    }

    console.log(
      JSON.stringify(
        {
          passed: true,
          scenario: 'isolated-worker-replica-claim',
          jobId: job.id,
          status: observed.status,
          attempts: observed.attempts,
          terminalReason: observed.error,
          startedAt: observed.startedAt.toISOString(),
          finishedAt: observed.finishedAt.toISOString(),
          providerIntegration: 'not exercised by empty fixture',
          cleanup: 'temporary world deleted in finally'
        },
        null,
        2
      )
    );
  } finally {
    if (worldId) await prisma.world.delete({ where: { id: worldId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    `worker replica claim smoke failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
