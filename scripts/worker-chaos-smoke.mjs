#!/usr/bin/env node
/** Local, disposable worker drill. Never defaults to the product Compose stack. */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';

const execFileAsync = promisify(execFile);
const projectPattern = /^worldloom-drill-[a-f0-9]{32}$/;
const containerPattern = /^[a-f0-9]{64}$/;
class DrillError extends Error {}
function requireCondition(value, message) {
  if (!value) throw new DrillError(message);
}

export function parseDrillOptions(args) {
  const options = { timeoutMs: 300_000, entityCount: 512, scenario: 'kill-restart' };
  const seen = new Set();
  for (const arg of args.filter((value) => value !== '--')) {
    const match = /^--(project|compose-file|timeout-ms|entities|scenario)=([^=]+)$/.exec(arg);
    requireCondition(match && !seen.has(match[1]), 'Unknown, duplicate, or malformed drill option');
    const [, key, value] = match;
    seen.add(key);
    if (key === 'project') options.project = value;
    if (key === 'compose-file') options.composeFile = value;
    if (key === 'scenario') options.scenario = value;
    if (key === 'timeout-ms' || key === 'entities') {
      const minimum = key === 'timeout-ms' ? 150_000 : 64;
      const maximum = key === 'timeout-ms' ? 600_000 : 5_000;
      requireCondition(/^[0-9]+$/.test(value) && Number(value) >= minimum && Number(value) <= maximum,
        'Drill numeric option is out of range');
      options[key === 'timeout-ms' ? 'timeoutMs' : 'entityCount'] = Number(value);
    }
  }
  requireCondition(projectPattern.test(options.project ?? ''), 'An explicit disposable drill project is required');
  requireCondition(options.composeFile && path.isAbsolute(options.composeFile), 'An absolute drill Compose file is required');
  requireCondition(['kill-restart', 'replica-race'].includes(options.scenario), 'Unsupported drill scenario');
  return options;
}

function environment(container) {
  return Object.fromEntries((container.Config?.Env ?? []).map((item) => {
    const separator = item.indexOf('=');
    return [item.slice(0, separator), item.slice(separator + 1)];
  }));
}

function parseDatabaseUrl(value) {
  try {
    const url = new URL(value);
    requireCondition(['postgres:', 'postgresql:'].includes(url.protocol), 'Unsupported database protocol');
    requireCondition(!url.search && !url.hash, 'Database URL overrides are not allowed in this drill');
    return url;
  } catch {
    throw new DrillError('Invalid drill database URL');
  }
}

/** Prove actual container/DB identity before creating a fixture or killing anything. */
export function assertDrillIsolation(options, databaseUrl, db, workers) {
  const expectedDatabase = options.project.replaceAll('-', '_');
  requireCondition(projectPattern.test(options.project), 'Unsafe drill project');
  requireCondition(workers.length === (options.scenario === 'replica-race' ? 2 : 1), 'Unexpected worker replica count');
  for (const [container, service] of [[db, 'db'], ...workers.map((worker) => [worker, 'worker'])]) {
    const labels = container.Config?.Labels ?? {};
    requireCondition(containerPattern.test(container.Id ?? '') && container.State?.Running,
      'Drill container is not running or has an invalid identity');
    requireCondition(labels['com.docker.compose.project'] === options.project &&
      labels['com.docker.compose.service'] === service &&
      labels['com.docker.compose.project.config_files'] === options.composeFile &&
      labels['io.worldloom.disposable-drill'] === options.project,
      'Container does not belong to the explicit disposable drill');
  }
  requireCondition(db.HostConfig?.Tmpfs?.['/var/lib/postgresql/data'], 'Drill PostgreSQL data must be disposable tmpfs');
  requireCondition(!db.Mounts?.some((mount) => mount.Destination === '/var/lib/postgresql/data' && mount.Type !== 'tmpfs'),
    'Persistent database storage is forbidden for this drill');
  const dbEnv = environment(db);
  requireCondition(dbEnv.POSTGRES_DB === expectedDatabase, 'Drill database name does not match project');
  const hostUrl = parseDatabaseUrl(databaseUrl);
  const bindings = db.NetworkSettings?.Ports?.['5432/tcp'] ?? [];
  requireCondition(hostUrl.hostname === '127.0.0.1' && bindings.length === 1 &&
    bindings[0].HostIp === '127.0.0.1' && bindings[0].HostPort === hostUrl.port &&
    hostUrl.pathname === `/${expectedDatabase}` &&
    decodeURIComponent(hostUrl.username) === dbEnv.POSTGRES_USER &&
    decodeURIComponent(hostUrl.password) === dbEnv.POSTGRES_PASSWORD,
    'Host database URL does not identify the disposable PostgreSQL container');
  for (const worker of workers) {
    const env = environment(worker);
    const workerUrl = parseDatabaseUrl(env.DATABASE_URL);
    requireCondition(workerUrl.hostname === 'db' && workerUrl.port === '5432' &&
      workerUrl.pathname === hostUrl.pathname && workerUrl.username === hostUrl.username &&
      workerUrl.password === hostUrl.password,
      'Worker and host do not share the disposable database');
    requireCondition(env.WORLDLOOM_WORKER === 'true' && env.WORLDLOOM_WORKER_MAX_CONCURRENCY === '1',
      'Drill worker must use the explicit one-slot process cap');
    requireCondition(!Object.entries(env).some(([key, value]) => /(?:API_KEY|TOKEN|SECRET)$/.test(key) && value),
      'Provider credentials are forbidden in this local-model drill');
  }
}

async function docker(args) {
  try {
    const result = await execFileAsync('docker', args, {
      maxBuffer: 2 * 1024 * 1024, timeout: 30_000
    });
    return result.stdout.trim();
  } catch {
    // Never expose command arguments, provider responses, environment, or stderr.
    throw new DrillError('Docker operation failed or timed out');
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForJob(prisma, jobId, predicate, deadline, pause) {
  while (Date.now() < deadline) {
    const job = await prisma.semanticIndexJob.findUnique({ where: { id: jobId } });
    if (predicate(job)) return job;
    await pause(250);
  }
  throw new DrillError('Worker job timed out');
}

async function vectorStats(prisma, worldId) {
  const rows = await prisma.$queryRaw`
    SELECT count(*)::int AS count, count(DISTINCT "targetUid")::int AS unique_targets,
      min(dims)::int AS min_dims, max(dims)::int AS max_dims,
      count(*) FILTER (WHERE embedding IS NULL)::int AS missing_embeddings
    FROM semantic_vectors WHERE "worldId" = ${worldId} AND version = 1
  `;
  return rows[0];
}

async function assertEmptyDatabase(prisma) {
  const counts = await Promise.all([
    prisma.world.count(), prisma.semanticIndexJob.count(), prisma.compileRun.count(),
    prisma.$queryRaw`SELECT count(*)::int AS count FROM semantic_vectors`
  ]);
  requireCondition(counts[0] === 0 && counts[1] === 0 && counts[2] === 0 && counts[3][0]?.count === 0,
    'Drill database contains unrelated or uncleaned data');
}

function assertCompleted(job, stats, entityCount, attempts, recoveries) {
  requireCondition(job?.status === 'completed' && job.attempts === attempts &&
    job.recoveryAttempts === recoveries && job.indexed === entityCount &&
    Number(stats.count) === entityCount && Number(stats.unique_targets) === entityCount &&
    Number(stats.min_dims) === 1024 && Number(stats.max_dims) === 1024 && Number(stats.missing_embeddings) === 0,
    'Worker completion, recovery, or vector idempotency contract failed');
}

export async function runWorkerDrill(options, {
  databaseUrl = process.env.DATABASE_URL, dockerFn = docker,
  createPrisma = () => new PrismaClient({ log: [], datasourceUrl: databaseUrl }),
  pause = sleep, resolveFile = (filename) => realpath(filename)
} = {}) {
  // Validate direct library calls as strictly as CLI calls, before Docker or Prisma.
  parseDrillOptions([`--project=${options.project}`, `--compose-file=${options.composeFile}`,
    `--scenario=${options.scenario}`, `--timeout-ms=${options.timeoutMs}`, `--entities=${options.entityCount}`]);
  options = { ...options, composeFile: await resolveFile(options.composeFile) };
  const compose = ['compose', '--env-file', '/dev/null', '-p', options.project, '-f', options.composeFile];
  const inspect = async (id) => {
    requireCondition(containerPattern.test(id), 'Invalid drill container ID');
    try { return JSON.parse(await dockerFn(['inspect', id]))[0]; }
    catch { throw new DrillError('Unable to inspect drill container'); }
  };
  const readScope = async () => {
    const workerIds = (await dockerFn([...compose, 'ps', '-q', 'worker'])).split(/\s+/).filter(Boolean);
    const dbIds = (await dockerFn([...compose, 'ps', '-q', 'db'])).split(/\s+/).filter(Boolean);
    requireCondition(dbIds.length === 1, 'Exactly one disposable database is required');
    const db = await inspect(dbIds[0]);
    const workers = await Promise.all(workerIds.map(inspect));
    assertDrillIsolation(options, databaseUrl, db, workers);
    return { db, workers };
  };
  const initial = await readScope();
  const prisma = createPrisma();
  const token = randomUUID();
  const fixtureName = `WorldLoom-worker-drill-${token}`;
  let worldId;
  let killedWorker;
  let result;
  let failed;
  try {
    await assertEmptyDatabase(prisma);
    const world = await prisma.world.create({
      data: { name: fixtureName, premise: 'Disposable local worker recovery fixture' }, select: { id: true }
    });
    worldId = world.id;
    await prisma.entity.createMany({ data: Array.from({ length: options.entityCount }, (_, index) => ({
      worldId, version: 1, uid: `worker_drill_${token}_${index}`, kind: 'concept',
      name: `Drill entity ${index}`, summary: `Deterministic fixture ${index}`,
      content: `Temporary local embedding fixture ${index}; no user data or paid provider.`
    })) });
    const job = await prisma.semanticIndexJob.create({ data: { worldId, version: 1, status: 'queued' }, select: { id: true } });
    let restart = null;
    if (options.scenario === 'kill-restart') {
      const claimed = await waitForJob(prisma, job.id,
        (value) => ['running', 'failed', 'completed'].includes(value?.status), Date.now() + 60_000, pause);
      requireCondition(claimed.status === 'running' && claimed.attempts === 1, 'Worker was not running at fault injection');
      const scope = await readScope(); // Recheck exact target immediately before destructive action.
      requireCondition(scope.db.Id === initial.db.Id && scope.workers[0].Id === initial.workers[0].Id,
        'Drill containers changed before fault injection');
      killedWorker = scope.workers[0].Id; // Set before kill so even an interrupted command gets a restart attempt.
      await dockerFn(['kill', '--signal=SIGKILL', killedWorker]);
      await dockerFn(['start', killedWorker]); // Restart only the validated ID, never `compose up`.
      const after = await inspect(killedWorker);
      requireCondition(after.State?.Running && after.State.StartedAt !== scope.workers[0].State.StartedAt,
        'Killed worker did not restart');
      restart = { containerId: killedWorker, before: scope.workers[0].State.StartedAt, after: after.State.StartedAt };
    }
    const expectedAttempts = options.scenario === 'kill-restart' ? 2 : 1;
    const expectedRecoveries = options.scenario === 'kill-restart' ? 1 : 0;
    const completed = await waitForJob(prisma, job.id,
      (value) => ['completed', 'failed'].includes(value?.status), Date.now() + options.timeoutMs, pause);
    const firstStats = await vectorStats(prisma, worldId);
    assertCompleted(completed, firstStats, options.entityCount, expectedAttempts, expectedRecoveries);
    // Explicit at-least-once replay of the SAME durable job, retaining vectors and attempts.
    const replay = await prisma.semanticIndexJob.updateMany({
      where: { id: job.id, worldId, status: 'completed', attempts: expectedAttempts },
      data: { status: 'queued', indexed: 0, error: null, finishedAt: null }
    });
    requireCondition(replay.count === 1, 'Completed job changed before owned replay');
    const replayed = await waitForJob(prisma, job.id,
      (value) => ['completed', 'failed'].includes(value?.status), Date.now() + options.timeoutMs, pause);
    const replayStats = await vectorStats(prisma, worldId);
    assertCompleted(replayed, replayStats, options.entityCount, expectedAttempts + 1, expectedRecoveries);
    const finalScope = await readScope();
    requireCondition(finalScope.db.Id === initial.db.Id &&
      finalScope.workers.map((value) => value.Id).sort().join(',') === initial.workers.map((value) => value.Id).sort().join(','),
      'Drill topology changed during verification');
    result = { passed: true, scenario: options.scenario, project: options.project, jobId: job.id,
      replicas: initial.workers.length, processConcurrency: 1, entityCount: options.entityCount,
      firstAttempts: completed.attempts, replayAttempts: replayed.attempts,
      recoveryAttempts: replayed.recoveryAttempts, vectors: replayStats, restart,
      providerCalls: 'no provider credentials supplied; cached local model',
      evidenceScope: 'local disposable environment, not target deployment or cross-host HA' };
  } catch (error) {
    failed = error instanceof DrillError ? error : new DrillError('Worker drill operation failed; private details suppressed');
  } finally {
    if (killedWorker) {
      try { await dockerFn(['start', killedWorker]); }
      catch { failed = new DrillError('Drill worker restart cleanup failed'); }
    }
    try {
      if (worldId) {
        const own = await prisma.world.findUnique({ where: { id: worldId }, select: { name: true } });
        requireCondition(own?.name === fixtureName, 'Fixture identity changed; refusing deletion');
        await prisma.world.delete({ where: { id: worldId, name: fixtureName } });
        requireCondition(await prisma.world.count({ where: { id: worldId } }) === 0, 'Fixture deletion was not confirmed');
        await assertEmptyDatabase(prisma);
      }
    } catch { failed = new DrillError('Fixture cleanup failed; inspect the disposable drill before retrying'); }
    try { await prisma.$disconnect(); }
    catch { failed = new DrillError('Drill database disconnect failed'); }
  }
  if (failed) throw failed;
  return { ...result, cleanup: 'owned world, jobs, compile runs and vectors verified absent' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await runWorkerDrill(parseDrillOptions(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof DrillError ? error.message : 'Worker drill failed; private details suppressed');
    process.exitCode = 1;
  }
}
