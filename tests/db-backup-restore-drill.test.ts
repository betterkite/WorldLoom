import { describe, expect, it } from 'vitest';
import { BackupDrillError, backupResources } from '../scripts/backup-drill-contract.mjs';
import { runBackupRestoreDrill } from '../scripts/db-backup-restore-drill.mjs';

// Only dependency-injected transcripts: importing the runner must not start its CLI.
// Explicit synthetic environment; never inherit operator credentials or database URLs.
const cleanEnvironment: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
const uuid = '12345678-1234-1234-1234-123456789abc';
const resources = backupResources(uuid);
const containerId = 'a'.repeat(64);
const directory = '/tmp/worldloom-backup-drill-12345678123412341234123456789abc-aB1234';
type Controls = { input?: string; capture?: boolean };
function fixture(
  options: {
    noUsage?: boolean;
    changedContent?: boolean;
    restoreInventory?: boolean;
    failCreate?: boolean;
    wrongMarker?: boolean;
    failRestore?: boolean;
    failDirectoryCleanup?: boolean;
    failDatabaseCleanup?: boolean;
    changedContainer?: boolean;
    invalidDirectory?: boolean;
    remoteContext?: boolean;
    failSessionClose?: boolean;
    unsupportedTimeout?: boolean;
    utilityTimeout?: boolean;
  } = {}
) {
  const events: string[] = [];
  const commands: { args: string[]; controls?: Controls }[] = [];
  const tables = ['_prisma_migrations', ...(options.noUsage ? [] : ['llm_usage_calls']), 'worlds'];
  const fingerprints = tables.map((table) => ({ table, rows: '1', sha256: 'a'.repeat(64) }));
  let sessionIndex = 0;
  let inspections = 0;
  const docker = async (args: string[], controls?: Controls) => {
    commands.push({ args, controls });
    if (args[0] === 'context')
      return JSON.stringify(
        options.remoteContext ? 'tcp://remote.invalid:2375' : 'unix:///fixture.sock'
      );
    if (args[0] === 'inspect') {
      inspections += 1;
      return JSON.stringify({
        id: options.changedContainer && inspections > 1 ? 'b'.repeat(64) : containerId,
        running: true,
        project: 'worldloom',
        service: 'db'
      });
    }
    expect(args[0]).toBe('exec');
    const index = args.indexOf(containerId);
    expect(index).toBeGreaterThan(0);
    if (args[index + 1] === 'timeout' && args[index + 2] === '--version') {
      events.push('timeout:version');
      return options.unsupportedTimeout
        ? 'non-GNU private-version-sentinel'
        : 'timeout (GNU coreutils) 9.1';
    }
    const command = args[index + 1] === 'timeout' ? args[index + 5] : args[index + 1];
    events.push(command);
    if (command === 'pg_dump' || command === 'pg_restore') {
      expect(args.slice(index + 1, index + 5)).toEqual([
        'timeout',
        '--signal=TERM',
        '--kill-after=5s',
        '45s'
      ]);
      if (options.utilityTimeout) throw new Error('private-timeout-sentinel');
    }
    if (command === 'mktemp')
      return options.invalidDirectory ? '/private-directory-sentinel' : directory;
    if (command === 'stat')
      return args.at(-1) === directory ? 'directory:700' : 'regular empty file:600';
    if (command === 'psql') {
      // Docker options belong BEFORE the container, never after it as a command.
      expect(args.indexOf('-i')).toBeLessThan(index);
      expect(args).toContain('PGOPTIONS=-c statement_timeout=60000 -c lock_timeout=5000');
      expect(args).toContain('/var/run/postgresql');
      expect(args).toContain('ON_ERROR_STOP=1');
      const query = controls?.input ?? '';
      events.push(query);
      if (query.startsWith('CREATE') && options.failCreate)
        throw new Error('private-create-sentinel');
      if (query.startsWith('SELECT shobj'))
        return options.wrongMarker ? 'unowned' : resources.marker;
      if (query.startsWith('DROP') && options.failDatabaseCleanup)
        throw new Error('private-drop-sentinel');
      if (query.startsWith('SELECT COUNT')) return '0';
    }
    if (command === 'pg_dump') {
      expect(events).toContain('source:fingerprints');
      expect(events).not.toContain('source:close');
      expect(args).toContain('--snapshot=00000003-0000001B-1');
      expect(controls?.capture).toBe(false);
    }
    if (command === 'pg_restore') {
      expect(events).toContain('source:close');
      expect(controls?.capture).toBe(false);
      if (options.failRestore) throw new Error('private-provider-password-sentinel');
    }
    if (command === 'rmdir' && options.failDirectoryCleanup)
      throw new Error('private-rmdir-sentinel');
    return '';
  };
  const openSnapshot = (id: string, user: string, database: string) => {
    expect(id).toBe(containerId);
    expect(user).toBe('worldloom');
    const restored = sessionIndex++ > 0;
    const name = restored ? 'restore' : 'source';
    return {
      async metadata(exported: boolean) {
        expect(exported).toBe(!restored);
        return {
          database,
          serverVersion: '160006',
          foreignTables: '0',
          otherSchemas: [],
          snapshot: exported ? '00000003-0000001B-1' : null,
          tables: restored && options.restoreInventory ? [...tables, 'unexpected'] : tables
        };
      },
      async fingerprints() {
        events.push(`${name}:fingerprints`);
        return fingerprints.map((entry) => ({
          ...entry,
          sha256: restored && options.changedContent ? 'b'.repeat(64) : entry.sha256
        }));
      },
      async close() {
        events.push(`${name}:close`);
        if (options.failSessionClose) throw new Error('private-session-sentinel');
      }
    };
  };
  return { events, commands, dependencies: { uuid: () => uuid, docker, openSnapshot } };
}
const drops = (value: ReturnType<typeof fixture>) =>
  value.commands.filter(({ controls }) => controls?.input?.startsWith('DROP'));
const deletes = (value: ReturnType<typeof fixture>) =>
  value.commands.filter(({ args }) => args.includes('rm') || args.includes('rmdir'));

describe('backup restore orchestration with fake command/session boundaries only', () => {
  it('compares a shared snapshot and reports success only after exact cleanup', async () => {
    const value = fixture();
    const report = await runBackupRestoreDrill(cleanEnvironment, value.dependencies);
    expect(report).toMatchObject({
      passed: true,
      durableBackup: false,
      releaseApproved: false,
      usageRestoreStatus: 'row-content-compared',
      cleanup: {
        temporaryDatabase: 'removed',
        privateDumpDirectory: 'removed',
        snapshotSessions: 'closed'
      }
    });
    expect(value.events.at(-1)).toBe('rmdir');
    expect(drops(value)).toHaveLength(1);
    expect(drops(value)[0].controls?.input).toBe(`DROP DATABASE "${resources.database}";`);
    expect(
      value.commands.some(
        ({ args }) => args.includes('rm') && args.some((arg) => /^-[a-z]*r/.test(arg))
      )
    ).toBe(false);
    expect(
      value.commands
        .filter(({ args }) => args[0] === 'inspect')
        .at(-1)
        ?.args.at(-1)
    ).toBe(containerId);
  });

  it('does not claim migrated usage coverage when the source predates the usage table', async () => {
    const value = fixture({ noUsage: true });
    expect(await runBackupRestoreDrill(cleanEnvironment, value.dependencies)).toMatchObject({
      usageTablePresent: false,
      usageRestoreStatus: 'not-present-in-source-snapshot'
    });
  });

  it('refuses an unsupported in-container deadline tool before creating temporary resources', async () => {
    const value = fixture({ unsupportedTimeout: true });
    const error = await runBackupRestoreDrill(cleanEnvironment, value.dependencies).catch(
      (caught) => caught
    );
    expect(error.code).toBe('unsupported_container_timeout');
    expect(value.events).not.toContain('mktemp');
    expect(drops(value)).toHaveLength(0);
    expect(deletes(value)).toHaveLength(0);
    expect(JSON.stringify(error)).not.toContain('private-version-sentinel');
  });

  it('fails rather than returning success on a utility deadline, and still closes the snapshot', async () => {
    const value = fixture({ utilityTimeout: true });
    const error = await runBackupRestoreDrill(cleanEnvironment, value.dependencies).catch(
      (caught) => caught
    );
    expect(error).toBeInstanceOf(BackupDrillError);
    expect(value.events).toContain('source:close');
    expect(drops(value)).toHaveLength(0);
    expect(deletes(value)).toHaveLength(3);
    expect(JSON.stringify(error)).not.toContain('private-timeout-sentinel');
  });

  it.each(['changedContent', 'restoreInventory', 'failRestore'] as const)(
    'cleans only owned resources and rejects failed restoration: %s',
    async (failure) => {
      const value = fixture({ [failure]: true });
      const error = await runBackupRestoreDrill(cleanEnvironment, value.dependencies).catch(
        (caught) => caught
      );
      expect(error).toBeInstanceOf(BackupDrillError);
      expect(drops(value)).toHaveLength(1);
      expect(deletes(value)).toHaveLength(3);
      expect(JSON.stringify(error)).not.toContain('private-provider-password-sentinel');
    }
  );

  it.each(['failDirectoryCleanup', 'failDatabaseCleanup', 'failSessionClose'] as const)(
    'cannot emit a successful result when cleanup is unconfirmed: %s',
    async (failure) => {
      const value = fixture({ [failure]: true });
      await expect(
        runBackupRestoreDrill(cleanEnvironment, value.dependencies)
      ).rejects.toMatchObject({
        code: 'cleanup_unconfirmed'
      });
    }
  );

  it('never drops a database whose CREATE failed or ownership marker cannot be confirmed', async () => {
    for (const options of [{ failCreate: true }, { wrongMarker: true }]) {
      const value = fixture(options);
      await expect(
        runBackupRestoreDrill(cleanEnvironment, value.dependencies)
      ).rejects.toBeInstanceOf(BackupDrillError);
      expect(drops(value)).toHaveLength(0);
    }
  });

  it('refuses all destructive cleanup when the original container identity changes', async () => {
    const value = fixture({ changedContainer: true });
    await expect(runBackupRestoreDrill(cleanEnvironment, value.dependencies)).rejects.toMatchObject(
      {
        code: 'cleanup_unconfirmed'
      }
    );
    expect(drops(value)).toHaveLength(0);
    expect(deletes(value)).toHaveLength(0);
  });

  it('rejects invalid private paths without echoing or deleting them', async () => {
    const value = fixture({ invalidDirectory: true });
    const error = await runBackupRestoreDrill(cleanEnvironment, value.dependencies).catch(
      (caught) => caught
    );
    expect(error.code).toBe('invalid_dump_directory');
    expect(error.recovery.privateDumpDirectory).toBeNull();
    expect(JSON.stringify(error)).not.toContain('private-directory-sentinel');
    expect(deletes(value)).toHaveLength(0);
  });

  it('rejects nonlocal Docker before writes and never deletes source databases', async () => {
    const value = fixture({ remoteContext: true });
    await expect(runBackupRestoreDrill(cleanEnvironment, value.dependencies)).rejects.toMatchObject(
      {
        code: 'nonlocal_docker'
      }
    );
    expect(value.commands).toHaveLength(1);
    const override = fixture();
    await expect(
      runBackupRestoreDrill(
        { ...cleanEnvironment, DOCKER_HOST: 'tcp://remote.invalid:2375' },
        override.dependencies
      )
    ).rejects.toMatchObject({ code: 'nonlocal_docker' });
    expect(override.commands).toHaveLength(0);
    const valid = fixture();
    await runBackupRestoreDrill(cleanEnvironment, valid.dependencies);
    const queries = valid.commands.map(({ controls }) => controls?.input ?? '').join('\n');
    expect(queries).not.toContain('DROP DATABASE "worldloom"');
    expect(queries).not.toContain('DROP DATABASE "worldloom_test"');
    expect(queries).not.toContain('FORCE');
    expect(queries).not.toContain('pg_terminate_backend');
  });
});
