import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  insertPendingUsage,
  queryUsageGroups,
  settleUsage
} from '../../src/lib/llm/usage-store.mjs';
import {
  assertUsageFixtureSchema,
  usageFixtureDatabaseUrl,
  usageFixtureMarker
} from './usage-fixture-target.mjs';

// Invoked only by the owned-schema integration test. No app dotenv loader,
// provider client, app service, Docker or model dependency. The parent passes
// only the explicit test connection/scope, never its environment or keys.
// Prisma owns its SDK initialization; this is not a sandbox guarantee.
// URL is never passed on argv/output.
let database;
try {
  const raw = process.env.WORLDLOOM_USAGE_FIXTURE_DATABASE_URL;
  const schema = assertUsageFixtureSchema(process.env.WORLDLOOM_USAGE_FIXTURE_SCHEMA);
  const url = usageFixtureDatabaseUrl(raw, { schema });
  const bytes = [];
  let size = 0;
  for await (const part of process.stdin) {
    size += part.length;
    if (size > 4096) throw new Error();
    bytes.push(part);
  }
  const request = JSON.parse(Buffer.concat(bytes).toString('utf8'));
  if (!['record', 'pending-exit', 'read'].includes(request.action)) throw new Error();
  if (
    request.action === 'record' &&
    (!Number.isSafeInteger(request.inputTokens) ||
      request.inputTokens < 0 ||
      !Number.isSafeInteger(request.outputTokens) ||
      request.outputTokens < 0)
  )
    throw new Error();
  database = new PrismaClient({ datasourceUrl: url, log: [] });
  // Exact generated identifier only; no fallback to a public usage table.
  await database.$executeRawUnsafe(`SET search_path TO "${schema}"`);
  const [scope] = await database.$queryRaw`
    SELECT current_schema() AS "schema",
      obj_description(oid, 'pg_namespace') AS "marker"
    FROM pg_namespace WHERE nspname = ${schema}
  `;
  if (scope?.schema !== schema || scope?.marker !== usageFixtureMarker(schema)) throw new Error();
  const [table] = await database.$queryRaw`
    SELECT n.nspname AS "schema" FROM pg_class t
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE t.oid = to_regclass('llm_usage_calls')
  `;
  if (table?.schema !== schema) throw new Error();

  if (request.action === 'read') {
    process.stdout.write(
      JSON.stringify({ pid: process.pid, groups: await queryUsageGroups(database) })
    );
  } else {
    const attempt = {
      id: randomUUID(),
      profileId: 'isolated-child',
      model: 'mock-only',
      startedAt: new Date()
    };
    await insertPendingUsage(database, attempt);
    if (request.action === 'pending-exit') {
      // Exit after the confirmed start write, without a finalizer or graceful
      // client disconnect. This is our fixture process, never an app/worker.
      process.stdout.write(JSON.stringify({ pid: process.pid, id: attempt.id }), () =>
        process.exit(0)
      );
      await new Promise(() => {});
    } else {
      await settleUsage(database, attempt, {
        finishedAt: new Date(),
        status: 'completed',
        inputTokens: BigInt(request.inputTokens),
        outputTokens: BigInt(request.outputTokens)
      });
      process.stdout.write(JSON.stringify({ pid: process.pid, id: attempt.id }));
    }
  }
} catch {
  console.error('Isolated usage fixture process failed; connection and error values withheld');
  process.exitCode = 1;
} finally {
  if (database) {
    try {
      await database.$disconnect();
    } catch {
      console.error('Isolated usage fixture disconnect failed; error values withheld');
      process.exitCode = 1;
    }
  }
}
