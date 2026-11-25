import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  assertDrillIsolation,
  parseDrillOptions,
  runWorkerDrill
} from '../scripts/worker-chaos-smoke.mjs';

const project = `worldloom-drill-${'a'.repeat(32)}`;
const composeFile = '/fixture/worker-drill.compose.yml';
const database = project.replaceAll('-', '_');
const databaseUrl = `postgresql://drill:private@127.0.0.1:54321/${database}`;
const options = {
  ...parseDrillOptions([`--project=${project}`, `--compose-file=${composeFile}`]),
  entityCount: 64
};

function container(service: string, id: string) {
  return {
    Id: id.repeat(64),
    State: { Running: true, StartedAt: 'before' },
    Config: {
      Labels: {
        'com.docker.compose.project': project,
        'com.docker.compose.service': service,
        'com.docker.compose.project.config_files': composeFile,
        'io.worldloom.disposable-drill': project
      },
      Env:
        service === 'db'
          ? ['POSTGRES_USER=drill', 'POSTGRES_PASSWORD=private', `POSTGRES_DB=${database}`]
          : [
              `DATABASE_URL=postgresql://drill:private@db:5432/${database}`,
              'WORLDLOOM_WORKER=true',
              'WORLDLOOM_WORKER_MAX_CONCURRENCY=1'
            ]
    },
    HostConfig: { Tmpfs: { '/var/lib/postgresql/data': 'rw' } },
    Mounts: [] as { Destination: string; Type: string }[],
    NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54321' }] } }
  };
}

function mockDrill(
  flags: {
    deleteFailed?: boolean;
    startFailed?: boolean;
    renamed?: boolean;
    rawError?: boolean;
    nonempty?: boolean;
  } = {}
) {
  const db = container('db', 'b');
  const worker = container('worker', 'c');
  let created = false;
  let name = '';
  let deleted = false;
  let replayed = false;
  let reads = 0;
  let starts = 0;
  const dockerFn = vi.fn(async (args: string[]) => {
    if (args[0] === 'compose') return args.at(-1) === 'db' ? db.Id : worker.Id;
    if (args[0] === 'inspect') return JSON.stringify([args[1] === db.Id ? db : worker]);
    if (args[0] === 'kill') return worker.Id;
    if (args[0] === 'start') {
      starts += 1;
      if (flags.startFailed && starts === 1) throw new Error('private Docker credentials');
      worker.State.StartedAt = 'after';
      return worker.Id;
    }
    throw new Error('unexpected operation');
  });
  const prisma = {
    world: {
      count: vi.fn(async () => (flags.nonempty ? 1 : created && !deleted ? 1 : 0)),
      create: vi.fn(async ({ data }: { data: { name: string } }) => {
        created = true;
        name = data.name;
        return { id: 'own-world' };
      }),
      findUnique: vi.fn(async () => ({ name: flags.renamed ? 'user world' : name })),
      delete: vi.fn(async () => {
        if (flags.deleteFailed) throw new Error('private DB body');
        deleted = true;
      })
    },
    entity: {
      createMany: vi.fn(async () => {
        if (flags.rawError) throw new Error('private provider response');
      })
    },
    semanticIndexJob: {
      count: vi.fn(async () => (created && !deleted ? 1 : 0)),
      create: vi.fn(async () => ({ id: 'own-job' })),
      findUnique: vi.fn(async () => {
        reads += 1;
        return {
          status: reads === 1 ? 'running' : 'completed',
          attempts: replayed ? 3 : reads === 1 ? 1 : 2,
          recoveryAttempts: reads === 1 ? 0 : 1,
          indexed: 64
        };
      }),
      updateMany: vi.fn(async () => {
        replayed = true;
        return { count: 1 };
      })
    },
    compileRun: { count: vi.fn(async () => 0) },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) =>
      strings.join('').includes('DISTINCT')
        ? [{ count: 64, unique_targets: 64, min_dims: 1024, max_dims: 1024, missing_embeddings: 0 }]
        : [{ count: 0 }]
    ),
    $disconnect: vi.fn(async () => {})
  };
  const createPrisma = vi.fn(() => prisma as unknown as PrismaClient);
  return {
    prisma,
    dockerFn,
    createPrisma,
    databaseUrl,
    resolveFile: async (value: string) => value
  };
}

describe('worker drill isolation', () => {
  it('accepts an explicit, empty disposable topology', () => {
    expect(() =>
      assertDrillIsolation(options, databaseUrl, container('db', 'b'), [container('worker', 'c')])
    ).not.toThrow();
  });
  it.each([
    'worldloom',
    'worldloom_test',
    '',
    '--bad',
    '--entities=1',
    '--entities=64=extra',
    '--scenario=production'
  ])('rejects unsafe or implicit CLI scope: %s', (arg) => {
    expect(() => parseDrillOptions([arg])).toThrow();
  });
  it('rejects duplicate options and relative Compose paths', () => {
    expect(() =>
      parseDrillOptions([
        `--project=${project}`,
        `--project=${project}`,
        `--compose-file=${composeFile}`
      ])
    ).toThrow();
    expect(() =>
      parseDrillOptions([`--project=${project}`, '--compose-file=docker-compose.yml'])
    ).toThrow();
  });
  it.each(['project', 'service', 'config_files', 'disposable'])(
    'rejects mismatched container labels: %s',
    (label) => {
      const worker = container('worker', 'c');
      const key =
        label === 'disposable'
          ? 'io.worldloom.disposable-drill'
          : `com.docker.compose.${label === 'config_files' ? 'project.config_files' : label}`;
      (worker.Config.Labels as Record<string, string>)[key] = 'worldloom';
      expect(() =>
        assertDrillIsolation(options, databaseUrl, container('db', 'b'), [worker])
      ).toThrow();
    }
  );
  it.each([
    'postgresql://drill:private@127.0.0.1:43133/worldloom',
    `postgresql://drill:private@127.0.0.1:54321/${database}?schema=other`,
    `postgresql://drill:private@remote:54321/${database}`
  ])('rejects a host URL not bound to the disposable DB: %s', (url) => {
    expect(() =>
      assertDrillIsolation(options, url, container('db', 'b'), [container('worker', 'c')])
    ).toThrow();
  });
  it('rejects persistent PostgreSQL storage, unexpected replicas and provider credentials', () => {
    const db = container('db', 'b');
    db.Mounts.push({ Destination: '/var/lib/postgresql/data', Type: 'volume' });
    expect(() =>
      assertDrillIsolation(options, databaseUrl, db, [container('worker', 'c')])
    ).toThrow();
    expect(() => assertDrillIsolation(options, databaseUrl, container('db', 'b'), [])).toThrow();
    const worker = container('worker', 'c');
    worker.Config.Env.push('EMBEDDINGS_API_KEY=private');
    expect(() =>
      assertDrillIsolation(options, databaseUrl, container('db', 'b'), [worker])
    ).toThrow();
  });
  it('accepts exactly two bounded workers only for the replica scenario', () => {
    expect(() =>
      assertDrillIsolation(
        { ...options, scenario: 'replica-race' },
        databaseUrl,
        container('db', 'b'),
        [container('worker', 'c'), container('worker', 'd')]
      )
    ).not.toThrow();
  });
});

describe('worker drill fault and cleanup boundaries', () => {
  it('fails before Docker or Prisma when called with normal project scope', async () => {
    const mock = mockDrill();
    await expect(runWorkerDrill({ ...options, project: 'worldloom' }, mock)).rejects.toThrow();
    expect(mock.dockerFn).not.toHaveBeenCalled();
    expect(mock.createPrisma).not.toHaveBeenCalled();
  });
  it('kills and restarts only the verified ID, replays the job, and confirms cleanup before passing', async () => {
    const mock = mockDrill();
    const result = await runWorkerDrill(options, mock);
    expect(result).toMatchObject({
      passed: true,
      firstAttempts: 2,
      replayAttempts: 3,
      recoveryAttempts: 1
    });
    expect(mock.dockerFn.mock.calls.filter(([args]) => args[0] === 'kill')).toEqual([
      [['kill', '--signal=SIGKILL', 'c'.repeat(64)]]
    ]);
    expect(mock.dockerFn.mock.calls.some(([args]) => args.includes('up'))).toBe(false);
    expect(mock.prisma.world.delete).toHaveBeenCalledOnce();
    expect(result.cleanup).toContain('verified absent');
  });
  it('refuses fixture creation and fault injection in a nonempty database', async () => {
    const mock = mockDrill({ nonempty: true });
    await expect(runWorkerDrill(options, mock)).rejects.toThrow('unrelated');
    expect(mock.prisma.world.create).not.toHaveBeenCalled();
    expect(mock.dockerFn.mock.calls.some(([args]) => args[0] === 'kill')).toBe(false);
  });
  it.each([{ deleteFailed: true }, { renamed: true }])(
    'does not report PASS when fixture cleanup fails: %j',
    async (flags) => {
      const mock = mockDrill(flags);
      await expect(runWorkerDrill(options, mock)).rejects.toThrow('cleanup failed');
      if (flags.renamed) expect(mock.prisma.world.delete).not.toHaveBeenCalled();
      expect(mock.prisma.$disconnect).toHaveBeenCalledOnce();
    }
  );
  it('attempts restart again after kill succeeds but the first restart fails', async () => {
    const mock = mockDrill({ startFailed: true });
    await expect(runWorkerDrill(options, mock)).rejects.toThrow('private details suppressed');
    expect(mock.dockerFn.mock.calls.filter(([args]) => args[0] === 'start')).toHaveLength(2);
    expect(mock.prisma.world.delete).toHaveBeenCalledOnce();
  });
  it('suppresses raw DB/provider errors while still cleaning its own fixture', async () => {
    const mock = mockDrill({ rawError: true });
    await expect(runWorkerDrill(options, mock)).rejects.toThrow('private details suppressed');
    expect(mock.prisma.world.delete).toHaveBeenCalledOnce();
  });
});
