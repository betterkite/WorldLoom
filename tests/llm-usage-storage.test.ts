import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient, type Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const isolated = vi.hoisted(() => {
  const state = { client: null as import('@prisma/client').PrismaClient | null };
  // Keep imports bound to this proxy while tests replace the owned connection.
  const proxy = new Proxy({} as import('@prisma/client').PrismaClient, {
    get(_target, property) {
      if (!state.client) throw new Error('Owned usage fixture connection is not open');
      const value = Reflect.get(state.client, property, state.client);
      return typeof value === 'function' ? value.bind(state.client) : value;
    }
  });
  return { state, proxy };
});
vi.mock('@/lib/db/client', () => ({ prisma: isolated.proxy }));

import {
  beginLlmUsageAttempt,
  finishLlmUsageAttempt,
  readLlmUsageSummary,
  type LlmUsageAttempt
} from '@/lib/llm/usage-tracking';
import {
  insertPendingUsage,
  queryUsageGroupsBounded,
  settleUsage
} from '@/lib/llm/usage-store.mjs';
import { createWorld, deleteWorld } from '@/lib/worldbuilding/worlds';
import {
  assertUsageFixtureSchema,
  usageFixtureDatabaseUrl,
  usageFixtureMarker
} from './helpers/usage-fixture-target.mjs';

// These are opt-in by actually running the test suite, not on module import.
// The suite must use a migrated worldloom_test/ci_test database. Never skip an
// unavailable DB and call that PASS. Never migrate or clean the public schema.
const schema = assertUsageFixtureSchema(
  `worldloom_usage_fixture_${randomUUID().replaceAll('-', '')}`
);
const marker = usageFixtureMarker(schema);
const childFile = fileURLToPath(new URL('./helpers/usage-fixture-process.mjs', import.meta.url));
const childCwd = fileURLToPath(new URL('../', import.meta.url));
const worldTables = [
  'worlds',
  'world_versions',
  'changes',
  'entities',
  'chronicle_events',
  'epochs'
] as const;
const worldEnumColumns = [
  ['changes', 'kind', 'ChangeKind'],
  ['changes', 'status', 'ChangeStatus'],
  ['entities', 'kind', 'EntityKind'],
  ['entities', 'confidence', 'Confidence'],
  ['chronicle_events', 'confidence', 'Confidence']
] as const;
let root: PrismaClient | null = null;
let scopedUrl = '';
let created = false;

function client(): PrismaClient {
  if (!isolated.state.client) throw new Error('Owned usage fixture connection is not open');
  return isolated.state.client;
}

async function assertOwnedScope(database: PrismaClient) {
  const rows = await database.$queryRaw<{ schema: string; marker: string | null }[]>`
    SELECT current_schema() AS "schema", obj_description(oid, 'pg_namespace') AS "marker"
    FROM pg_namespace WHERE nspname = ${schema}
  `;
  if (rows[0]?.schema !== schema || rows[0]?.marker !== marker) {
    throw new Error('Usage fixture connection does not point to its marked, owned schema');
  }
}

async function openOwnedConnection() {
  const database = new PrismaClient({ datasourceUrl: scopedUrl, log: [] });
  try {
    await database.$executeRawUnsafe(`SET search_path TO "${schema}"`);
    await assertOwnedScope(database);
    isolated.state.client = database;
  } catch {
    await database.$disconnect();
    throw new Error('Cannot open the marked usage fixture schema; target values withheld');
  }
}

async function closeOwnedConnection() {
  const database = isolated.state.client;
  isolated.state.client = null;
  if (database) await database.$disconnect();
}

function attempt(profileId = 'fixture-profile', model = 'mock-only'): LlmUsageAttempt {
  return { id: randomUUID(), profileId, model, startedAt: new Date() };
}

type UsageRow = {
  id: string;
  profileId: string;
  model: string;
  status: string;
  inputTokens: bigint | null;
  outputTokens: bigint | null;
  startedAt: Date;
  finishedAt: Date | null;
};

async function usageRow(id: string) {
  const rows = await client().$queryRaw<UsageRow[]>`
    SELECT * FROM "llm_usage_calls" WHERE "id" = ${id}
  `;
  expect(rows).toHaveLength(1);
  return rows[0];
}

type ChildResult = {
  pid: number;
  id?: string;
  groups?: {
    calls: string;
    knownUsageCalls: string;
    pendingCalls: string;
    inputTokens: string | null;
  }[];
};

function runFixtureProcess(request: Record<string, unknown>): ChildResult {
  if (isolated.state.client)
    throw new Error('Close the parent fixture connection before starting a child');
  const result = spawnSync(process.execPath, [childFile], {
    cwd: childCwd,
    // No process.env spread: no provider keys, app DB URL or instrumentation.
    env: {
      NODE_ENV: 'test',
      WORLDLOOM_USAGE_FIXTURE_DATABASE_URL: scopedUrl,
      WORLDLOOM_USAGE_FIXTURE_SCHEMA: schema
    },
    input: JSON.stringify(request),
    encoding: 'utf8',
    timeout: 7_500,
    maxBuffer: 64 * 1024
  });
  if (result.status !== 0 || result.signal || result.error || result.stderr.trim()) {
    throw new Error('Owned usage fixture child failed; connection and error values withheld');
  }
  let output: ChildResult;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    throw new Error('Owned usage fixture child returned an invalid response');
  }
  if (!Number.isSafeInteger(output?.pid) || output.pid <= 0 || output.pid === process.pid) {
    throw new Error('Owned usage fixture child did not identify a separate process');
  }
  return output;
}

async function connectionSettings() {
  return client().$queryRaw<{ readOnly: string; statementTimeout: string; lockTimeout: string }[]>`
    SELECT current_setting('transaction_read_only') AS "readOnly",
      current_setting('statement_timeout') AS "statementTimeout",
      current_setting('lock_timeout') AS "lockTimeout"
  `;
}

// Observe the actual SDK failure without substituting SQL, a fake timer, or a
// transaction. Only the public bounded reader's constant error reaches callers.
function observedBoundedRead(database: PrismaClient) {
  let underlying: unknown;
  const response = queryUsageGroupsBounded({
    $transaction: (
      operation: (transaction: Prisma.TransactionClient) => Promise<unknown>,
      options: { maxWait?: number; timeout?: number }
    ) =>
      database.$transaction(operation, options).catch((error: unknown) => {
        underlying = error;
        throw error;
      })
  });
  return { response, underlying: () => underlying };
}

// Hold exactly this owned fixture's transaction. Never terminate a backend or
// change pool/global defaults. The gate and SDK timeout bound failed tests too.
async function holdFixtureTransaction(database: PrismaClient, lockTable = false) {
  await assertOwnedScope(database);
  let release!: () => void;
  let acquired!: () => void;
  let rejected!: (error: Error) => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve, reject) => {
    acquired = resolve;
    rejected = reject;
  });
  const holding = database.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SET LOCAL statement_timeout = '2s'`;
      await transaction.$executeRaw`SET LOCAL lock_timeout = '1s'`;
      if (lockTable) {
        await transaction.$executeRaw`LOCK TABLE "llm_usage_calls" IN ACCESS EXCLUSIVE MODE`;
      } else {
        await transaction.$queryRaw`SELECT 1`;
      }
      acquired();
      await gate;
    },
    { maxWait: 1_000, timeout: 10_000 }
  );
  void holding.then(
    () => rejected(new Error('Owned fixture transaction ended before its gate')),
    () => rejected(new Error('Owned fixture transaction failed; values withheld'))
  );
  const finish = async () => {
    release();
    try {
      await holding;
    } catch {
      throw new Error('Owned fixture transaction cleanup failed; values withheld');
    }
  };
  try {
    await ready;
  } catch {
    await finish();
    throw new Error('Owned fixture transaction acquisition failed; values withheld');
  }
  return finish;
}

describe('LLM usage persistence on an isolated real PostgreSQL schema', () => {
  beforeAll(async () => {
    // Validate before creating any client. The guard also bounds pool/timeouts.
    const base = usageFixtureDatabaseUrl(process.env.DATABASE_URL);
    scopedUrl = usageFixtureDatabaseUrl(base, { schema });
    root = new PrismaClient({ datasourceUrl: base, log: [] });
    try {
      // Identifiers come only from the exact generated grammar above. Do not
      // use IF NOT EXISTS: an existing namespace is not ours to take over.
      await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      created = true;
      await root.$executeRawUnsafe(`COMMENT ON SCHEMA "${schema}" IS '${marker}'`);
      await openOwnedConnection();

      // Apply only this additive migration in the owned search_path, not the
      // project migration chain or db:push. These three statements are trusted
      // checked-in DDL; fail closed if its expected structure changes.
      const sql = readFileSync(
        new URL(
          '../prisma/migrations/20261001100000_llm_usage_calls/migration.sql',
          import.meta.url
        ),
        'utf8'
      );
      const statements = sql
        .split(';')
        .map((value) => value.replace(/^\s*--[^\n]*(?:\n|$)/gm, '').trim())
        .filter(Boolean);
      const starts = [
        'CREATE TABLE "llm_usage_calls" (',
        'CREATE INDEX "llm_usage_calls_profileId_model_idx" ON "llm_usage_calls"',
        'CREATE INDEX "llm_usage_calls_startedAt_idx" ON "llm_usage_calls"'
      ];
      if (
        statements.length !== starts.length ||
        statements.some((value, index) => !value.startsWith(starts[index]))
      ) {
        throw new Error('Unexpected usage fixture migration structure');
      }
      for (const statement of statements) await client().$executeRawUnsafe(statement);

      // Real world helper fixture: current migrated public columns/indexes are
      // copied, not public rows. LIKE leaves enum columns bound to public types;
      // Prisma qualifies enum parameters with the fixture schema. Copy actual
      // migrated labels and rebind the five enum columns inside the owned schema.
      const enumLabels = new Map<string, string[]>();
      for (const [, , enumName] of worldEnumColumns) {
        if (enumLabels.has(enumName)) continue;
        const labels = await client().$queryRaw<{ label: string }[]>`
          SELECT e.enumlabel AS "label" FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public' AND t.typname = ${enumName}
          ORDER BY e.enumsortorder
        `;
        if (!labels.length || labels.some(({ label }) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(label))) {
          throw new Error('Unexpected migrated world fixture enum labels');
        }
        enumLabels.set(
          enumName,
          labels.map(({ label }) => label)
        );
        await client().$executeRawUnsafe(
          `CREATE TYPE "${schema}"."${enumName}" AS ENUM (${labels.map(({ label }) => `'${label}'`).join(', ')})`
        );
      }
      // LIKE does not copy FKs, so add only the five
      // world cascades needed by createWorld/getWorld/deleteWorld. This does not
      // claim to validate every world table, production cascade or rollback.
      for (const table of worldTables) {
        await client().$executeRawUnsafe(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`
        );
        if (table !== 'worlds') {
          await client().$executeRawUnsafe(
            `ALTER TABLE "${schema}"."${table}" ADD CONSTRAINT "${table}_worldId_fkey" ` +
              `FOREIGN KEY ("worldId") REFERENCES "${schema}"."worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE`
          );
        }
      }
      for (const [table, column, enumName] of worldEnumColumns) {
        const columns = await client().$queryRaw<
          {
            enumName: string;
            defaultExpression: string | null;
          }[]
        >`
          SELECT ty.typname AS "enumName", pg_get_expr(d.adbin, d.adrelid) AS "defaultExpression"
          FROM pg_attribute a JOIN pg_class t ON t.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          JOIN pg_type ty ON ty.oid = a.atttypid
          LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE n.nspname = 'public' AND t.relname = ${table}
            AND a.attname = ${column} AND NOT a.attisdropped
        `;
        if (columns.length !== 1 || columns[0].enumName !== enumName) {
          throw new Error('Unexpected migrated world fixture enum column');
        }
        const defaultExpression = columns[0].defaultExpression;
        const defaultMatch = defaultExpression?.match(
          new RegExp(`^'([A-Za-z_][A-Za-z0-9_]*)'::(?:(?:"public"|public)\\.)?"${enumName}"$`)
        );
        if (
          defaultExpression !== null &&
          (!defaultMatch || !enumLabels.get(enumName)?.includes(defaultMatch[1]))
        ) {
          throw new Error('Unexpected migrated world fixture enum default');
        }
        await client().$executeRawUnsafe(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" DROP DEFAULT`
        );
        await client().$executeRawUnsafe(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" TYPE "${schema}"."${enumName}" ` +
            `USING "${column}"::text::"${schema}"."${enumName}"`
        );
        if (defaultMatch) {
          await client().$executeRawUnsafe(
            `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" ` +
              `SET DEFAULT '${defaultMatch[1]}'::"${schema}"."${enumName}"`
          );
        }
      }
    } catch {
      throw new Error(
        'Usage fixture setup failed; requires a migrated local test DB, target values withheld'
      );
    }
  }, 30_000);

  beforeEach(async () => {
    if (!isolated.state.client) await openOwnedConnection();
    await assertOwnedScope(client());
    const tables = await client().$queryRaw<{ schema: string }[]>`
      SELECT n.nspname AS "schema" FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE t.oid = to_regclass('llm_usage_calls')
    `;
    if (tables[0]?.schema !== schema)
      throw new Error('Usage fixture table ownership could not be confirmed');
    await client().$executeRaw`DELETE FROM "llm_usage_calls"`;
    await client().world.deleteMany(); // Only owned fixture worlds/cascades.
  });

  afterAll(async () => {
    let failed = false;
    try {
      await closeOwnedConnection();
      if (created && root) {
        const rows = await root.$queryRaw<{ marker: string | null }[]>`
          SELECT obj_description(oid, 'pg_namespace') AS "marker"
          FROM pg_namespace WHERE nspname = ${schema}
        `;
        if (rows[0]?.marker !== marker) throw new Error('Unconfirmed fixture ownership');
        // Exact random schema + matching ownership marker only. No database,
        // public schema, volumes, user worlds or other fixtures are removed.
        await root.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } catch {
      failed = true;
    } finally {
      try {
        if (root) await root.$disconnect();
      } catch {
        failed = true;
      }
      root = null;
    }
    if (failed)
      throw new Error('Usage fixture cleanup could not be confirmed; target values withheld');
  }, 15_000);

  it('reports an empty persistent store without inventing complete usage', async () => {
    const summary = await readLlmUsageSummary();
    expect(summary.totals).toEqual({
      calls: '0',
      knownUsageCalls: '0',
      unknownUsageCalls: '0',
      pendingCalls: '0',
      failedCalls: '0',
      inputTokens: null,
      outputTokens: null,
      totalTokens: null
    });
    expect(summary.recordedFrom).toBeNull();
    expect(summary.profiles).toEqual([]);
  });

  it('installs actual migration checks and indexes without a World foreign key', async () => {
    const constraints = await client().$queryRaw<{ name: string; type: string }[]>`
      SELECT c.conname AS "name", c.contype::text AS "type"
      FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ${schema} AND t.relname = 'llm_usage_calls'
    `;
    expect(
      constraints
        .filter((value) => value.type === 'c')
        .map((value) => value.name)
        .toSorted()
    ).toEqual([
      'llm_usage_calls_lifecycle_check',
      'llm_usage_calls_status_check',
      'llm_usage_calls_token_pair_check'
    ]);
    expect(constraints.some((value) => value.type === 'f')).toBe(false);
    const indexes = await client().$queryRaw<{ name: string }[]>`
      SELECT indexname AS "name" FROM pg_indexes WHERE schemaname = ${schema} AND tablename = 'llm_usage_calls'
    `;
    expect(indexes.map((value) => value.name).toSorted()).toEqual([
      'llm_usage_calls_pkey',
      'llm_usage_calls_profileId_model_idx',
      'llm_usage_calls_startedAt_idx'
    ]);
  });

  it.each([
    { status: 'other', input: null, output: null, finished: new Date() },
    { status: 'completed', input: BigInt(1), output: null, finished: new Date() },
    { status: 'failed', input: BigInt(-1), output: BigInt(2), finished: new Date() },
    { status: 'completed', input: BigInt(1), output: BigInt(2), finished: null },
    { status: 'pending', input: null, output: null, finished: new Date() },
    { status: 'pending', input: BigInt(0), output: BigInt(0), finished: null }
  ])(
    'rejects invalid persisted lifecycle/token pairs (case %#)',
    async ({ status, input, output, finished }) => {
      const id = randomUUID();
      await expect(client().$executeRaw`
      INSERT INTO "llm_usage_calls" ("id", "profileId", "model", "status", "inputTokens", "outputTokens", "finishedAt")
      VALUES (${id}, 'fixture-profile', 'mock-only', ${status}, ${input}, ${output}, ${finished})
    `).rejects.toMatchObject({ code: 'P2010', meta: { code: '23514' } });
      const rows = await client().$queryRaw<
        { calls: string }[]
      >`SELECT COUNT(*)::text AS "calls" FROM "llm_usage_calls"`;
      expect(rows[0].calls).toBe('0');
    }
  );

  it('makes duplicate starts/finalizers idempotent and never overwrites a terminal row', async () => {
    const current = await beginLlmUsageAttempt({ id: 'fixture-profile', model: 'mock-only' });
    await insertPendingUsage(client(), current);
    await finishLlmUsageAttempt(current, { inputTokens: 10, outputTokens: 20 }, true);
    const settled = await usageRow(current.id);
    await finishLlmUsageAttempt(current, { inputTokens: 99, outputTokens: 77 }, false);
    await insertPendingUsage(client(), current);
    expect(await usageRow(current.id)).toEqual(settled);
    expect(settled.status).toBe('completed');
    expect(settled.inputTokens).toBe(BigInt(10));
    expect((await readLlmUsageSummary()).totals.totalTokens).toBe('30');
    expect((await readLlmUsageSummary()).totals.calls).toBe('1');
  });

  it('does not leak statistics read-only/timeout settings into the single-connection fixture pool', async () => {
    const settings = () => client().$queryRaw<
      {
        readOnly: string;
        statementTimeout: string;
        lockTimeout: string;
      }[]
    >`
      SELECT current_setting('transaction_read_only') AS "readOnly",
        current_setting('statement_timeout') AS "statementTimeout",
        current_setting('lock_timeout') AS "lockTimeout"
    `;
    const before = await settings();
    expect(before[0].readOnly).toBe('off');
    await readLlmUsageSummary();
    expect(await settings()).toEqual(before);

    const current = await beginLlmUsageAttempt({ id: 'fixture-profile', model: 'mock-only' });
    await finishLlmUsageAttempt(current, { inputTokens: 2, outputTokens: 3 }, true);
    expect((await usageRow(current.id)).status).toBe('completed');
    expect((await readLlmUsageSummary()).totals.totalTokens).toBe('5');
    expect(await settings()).toEqual(before);
  });

  it('cancels a real slow aggregation with the local statement deadline and restores the pool', async () => {
    await assertOwnedScope(client());
    await insertPendingUsage(client(), attempt());
    const before = await connectionSettings();
    let renamed = false;
    let viewCreated = false;
    try {
      // Only the random, marked fixture's table is renamed. One synthetic row
      // forces this real view to sleep longer than the reader's 3s SQL limit.
      await client().$executeRaw`ALTER TABLE "llm_usage_calls" RENAME TO "usage_deadline_source"`;
      renamed = true;
      await client().$executeRaw`
        CREATE VIEW "llm_usage_calls" AS
        SELECT stored.* FROM "usage_deadline_source" stored
        WHERE pg_sleep(4) IS NOT NULL
      `;
      viewCreated = true;
      const observed = observedBoundedRead(client());
      await expect(observed.response).rejects.toThrow('LLM usage read unavailable.');
      expect(observed.underlying()).toMatchObject({ code: 'P2010', meta: { code: '57014' } });
      expect(await connectionSettings()).toEqual(before);
    } finally {
      await assertOwnedScope(client());
      if (viewCreated) await client().$executeRaw`DROP VIEW "llm_usage_calls"`;
      if (renamed)
        await client().$executeRaw`ALTER TABLE "usage_deadline_source" RENAME TO "llm_usage_calls"`;
    }
    expect((await readLlmUsageSummary()).totals).toMatchObject({ calls: '1', pendingCalls: '1' });
    await insertPendingUsage(client(), attempt());
    expect((await readLlmUsageSummary()).totals.calls).toBe('2');
  }, 20_000);

  it('bounds a real table-lock wait and releases only the owned blocker transaction', async () => {
    const before = await connectionSettings();
    const blocker = new PrismaClient({ datasourceUrl: scopedUrl, log: [] });
    let finish: (() => Promise<void>) | undefined;
    try {
      await blocker.$executeRawUnsafe(`SET search_path TO "${schema}"`);
      finish = await holdFixtureTransaction(blocker, true);
      const observed = observedBoundedRead(client());
      await expect(observed.response).rejects.toThrow('LLM usage read unavailable.');
      expect(observed.underlying()).toMatchObject({ code: 'P2010', meta: { code: '55P03' } });
    } finally {
      try {
        if (finish) await finish();
      } finally {
        await blocker.$disconnect();
      }
    }
    expect(await connectionSettings()).toEqual(before);
    await insertPendingUsage(client(), attempt());
    expect((await readLlmUsageSummary()).totals.calls).toBe('1');
  }, 20_000);

  it('rejects real single-pool transaction acquisition exhaustion without waiting for the holder', async () => {
    const before = await connectionSettings();
    const finish = await holdFixtureTransaction(client());
    try {
      const observed = observedBoundedRead(client());
      await expect(observed.response).rejects.toThrow('LLM usage read unavailable.');
      expect(observed.underlying()).toMatchObject({ code: 'P2028' });
    } finally {
      await finish();
    }
    expect(await connectionSettings()).toEqual(before);
    await insertPendingUsage(client(), attempt());
    expect((await readLlmUsageSummary()).totals.calls).toBe('1');
  }, 20_000);

  it('upserts a finalizer before a delayed start without regressing to pending', async () => {
    const current = attempt();
    await finishLlmUsageAttempt(current, { inputTokens: 3, outputTokens: 4 }, true);
    const settled = await usageRow(current.id);
    await insertPendingUsage(client(), current);
    expect(await usageRow(current.id)).toEqual(settled);
    expect((await readLlmUsageSummary()).totals).toMatchObject({
      calls: '1',
      pendingCalls: '0',
      totalTokens: '7'
    });
  });

  it('settles two competing finalizers once, retaining whichever wins', async () => {
    const current = await beginLlmUsageAttempt({ id: 'fixture-profile', model: 'mock-only' });
    await Promise.all([
      finishLlmUsageAttempt(current, { inputTokens: 1, outputTokens: 2 }, true),
      finishLlmUsageAttempt(current, { inputTokens: 5, outputTokens: 6 }, false)
    ]);
    const settled = await usageRow(current.id);
    expect([
      { status: 'completed', inputTokens: BigInt(1), outputTokens: BigInt(2) },
      { status: 'failed', inputTokens: BigInt(5), outputTokens: BigInt(6) }
    ]).toContainEqual({
      status: settled.status,
      inputTokens: settled.inputTokens,
      outputTokens: settled.outputTokens
    });
    await settleUsage(client(), current, {
      finishedAt: new Date(),
      status: 'completed',
      inputTokens: BigInt(100),
      outputTokens: BigInt(200)
    });
    expect(await usageRow(current.id)).toEqual(settled);
    expect((await readLlmUsageSummary()).totals).toMatchObject({
      calls: '1',
      knownUsageCalls: '1'
    });
  });

  it('keeps failure, known usage and pending/unknown usage as distinct dimensions', async () => {
    const known = await beginLlmUsageAttempt({ id: 'fixture-profile', model: 'first' });
    await finishLlmUsageAttempt(known, { inputTokens: 5, outputTokens: 7 }, false);
    const unknown = await beginLlmUsageAttempt({ id: 'fixture-profile', model: 'second' });
    await finishLlmUsageAttempt(unknown, null, false);
    await beginLlmUsageAttempt({ id: 'fixture-profile', model: 'second' });
    const summary = await readLlmUsageSummary();
    expect(summary.totals).toEqual({
      calls: '3',
      knownUsageCalls: '1',
      unknownUsageCalls: '2',
      pendingCalls: '1',
      failedCalls: '2',
      inputTokens: '5',
      outputTokens: '7',
      totalTokens: '12'
    });
    expect(summary.profiles).toHaveLength(2);
    expect(summary.profiles.find((value) => value.model === 'second')).toMatchObject({
      calls: '2',
      knownUsageCalls: '0',
      pendingCalls: '1',
      inputTokens: null,
      totalTokens: null
    });
  });

  it('sums valid per-call tokens beyond Number precision as exact decimal strings', async () => {
    for (let index = 0; index < 2; index += 1) {
      const current = await beginLlmUsageAttempt({ id: 'fixture-profile', model: 'mock-only' });
      await finishLlmUsageAttempt(
        current,
        { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 },
        true
      );
    }
    expect((await readLlmUsageSummary()).totals).toMatchObject({
      calls: '2',
      inputTokens: '18014398509481982',
      outputTokens: '2',
      totalTokens: '18014398509481984'
    });
  });

  it('distinguishes an explicitly reported zero-token completion from unknown usage', async () => {
    const current = await beginLlmUsageAttempt({ id: 'fixture-profile', model: 'mock-only' });
    await finishLlmUsageAttempt(current, { inputTokens: 0, outputTokens: 0 }, true);
    expect((await readLlmUsageSummary()).totals).toMatchObject({
      calls: '1',
      knownUsageCalls: '1',
      unknownUsageCalls: '0',
      inputTokens: '0',
      outputTokens: '0',
      totalTokens: '0'
    });
  });

  it('retains cumulative records after replacing the Prisma connection', async () => {
    const current = await beginLlmUsageAttempt({ id: 'fixture-profile', model: 'mock-only' });
    await finishLlmUsageAttempt(current, { inputTokens: 10, outputTokens: 20 }, true);
    const before = await readLlmUsageSummary();
    await closeOwnedConnection();
    await openOwnedConnection();
    const after = await readLlmUsageSummary();
    expect(after.totals).toEqual(before.totals);
    expect(after.recordedFrom).toBe(before.recordedFrom);
    expect(after.profiles).toEqual(before.profiles);
  });

  it('reads cumulative records written by separate, fresh native Node processes', async () => {
    await closeOwnedConnection();
    const first = runFixtureProcess({ action: 'record', inputTokens: 10, outputTokens: 20 });
    const second = runFixtureProcess({ action: 'record', inputTokens: 30, outputTokens: 40 });
    const reader = runFixtureProcess({ action: 'read' });
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.id).not.toBe(second.id);
    expect(first.pid).not.toBe(second.pid);
    expect(reader.pid).not.toBe(second.pid);
    expect(reader.groups).toHaveLength(1);
    expect(reader.groups?.[0]).toMatchObject({
      calls: '2',
      knownUsageCalls: '2',
      inputTokens: '40'
    });
    await openOwnedConnection();
    expect((await readLlmUsageSummary()).totals).toMatchObject({ calls: '2', totalTokens: '100' });
  }, 30_000);

  it('retains an interrupted child attempt as pending/unknown rather than zero complete usage', async () => {
    await closeOwnedConnection();
    const exited = runFixtureProcess({ action: 'pending-exit' });
    const reader = runFixtureProcess({ action: 'read' });
    expect(reader.pid).not.toBe(exited.pid);
    expect(reader.groups?.[0]).toMatchObject({
      calls: '1',
      knownUsageCalls: '0',
      pendingCalls: '1',
      inputTokens: null
    });
    await openOwnedConnection();
    expect((await readLlmUsageSummary()).totals).toMatchObject({
      calls: '1',
      unknownUsageCalls: '1',
      pendingCalls: '1',
      inputTokens: null,
      totalTokens: null
    });
    const row = await usageRow(exited.id!);
    expect(row.status).toBe('pending');
    expect(row.finishedAt).toBeNull();
  }, 25_000);

  it('does not reset usage when the real world delete helper deletes an owned fixture world', async () => {
    const world = await createWorld({ name: 'Isolated usage deletion fixture' });
    expect(await client().worldVersion.count({ where: { worldId: world.id } })).toBe(1);
    const change = await client().change.create({
      data: { worldId: world.id, kind: 'entity_upsert', payload: {}, baseVersion: 1 }
    });
    expect(change.status).toBe('pending');
    const current = await beginLlmUsageAttempt({ id: 'fixture-profile', model: 'mock-only' });
    await finishLlmUsageAttempt(current, { inputTokens: 7, outputTokens: 8 }, true);
    const before = await readLlmUsageSummary();
    await expect(deleteWorld(world.id)).resolves.toMatchObject({ id: world.id, deleted: true });
    expect(await client().world.findUnique({ where: { id: world.id } })).toBeNull();
    expect(await client().worldVersion.count({ where: { worldId: world.id } })).toBe(0);
    expect(await client().change.count({ where: { worldId: world.id } })).toBe(0);
    const after = await readLlmUsageSummary();
    expect(after.totals).toEqual(before.totals);
    expect(after.recordedFrom).toBe(before.recordedFrom);
  });
});
