import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BackupDrillError,
  backupOptions,
  backupResources,
  backupContainer,
  backupTables,
  snapshotMetadata,
  snapshotSQL,
  fingerprintSQL,
  fingerprintReader,
  compareBackup
} from '../scripts/backup-drill-contract.mjs';
import { postgresArgs, postgresUtilityArgs } from '../scripts/backup-drill-transport.mjs';

const uuid = '12345678-1234-1234-1234-123456789abc';
const tables = ['_prisma_migrations', 'llm_usage_calls', 'worlds'];
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const metadata = () => ({
  database: 'worldloom',
  serverVersion: '160006',
  foreignTables: '0',
  otherSchemas: [],
  snapshot: '00000003-0000001B-1',
  tables: [...tables]
});
function fingerprints(rows: Record<string, string[]> = {}) {
  const reader = fingerprintReader(tables);
  for (const table of tables) {
    reader.line(`WL_TABLE:${table}`);
    for (const digest of (rows[table] ?? []).toSorted()) reader.line(digest);
    reader.line('WL_TABLE_END');
  }
  return reader.finish();
}

describe('local backup drill source contracts (no Docker or database)', () => {
  it('defaults only to WorldLoom and refuses explicit blank or foreign targets', () => {
    expect(backupOptions({})).toEqual({
      container: 'worldloom-db',
      dbUser: 'worldloom',
      sourceDatabase: 'worldloom'
    });
    expect(backupOptions({ WORLDLOOM_DB_NAME: 'worldloom_test' }).sourceDatabase).toBe(
      'worldloom_test'
    );
    for (const env of [
      { WORLDLOOM_DB_NAME: '' },
      { WORLDLOOM_DB_NAME: null },
      { WORLDLOOM_DB_USER: null },
      { WORLDLOOM_DB_CONTAINER: null },
      { WORLDLOOM_DB_NAME: 'other_project' },
      { WORLDLOOM_DB_NAME: 'postgresql://private-sentinel' },
      { WORLDLOOM_DB_CONTAINER: '-other' },
      { WORLDLOOM_DB_CONTAINER: 'container; command' },
      { WORLDLOOM_DB_USER: 'role"; DROP' }
    ])
      expect(() => backupOptions(env)).toThrow(BackupDrillError);
  });

  it('admits one exact UUID namespace, not prefixes, arbitrary paths or broad deletion targets', () => {
    const value = backupResources(uuid);
    expect(value.database.length).toBeLessThanOrEqual(63);
    expect(
      value.directoryPattern.test(
        '/tmp/worldloom-backup-drill-12345678123412341234123456789abc-aB1234'
      )
    ).toBe(true);
    for (const path of [
      '/tmp',
      '/',
      '/tmp/worldloom-backup-drill-other-aB1234',
      '/tmp/worldloom-backup-drill-12345678123412341234123456789abc-aB1234/extra'
    ]) {
      expect(value.directoryPattern.test(path)).toBe(false);
    }
    expect(() => backupResources('bad-private-sentinel')).toThrow(BackupDrillError);
  });

  it('requires the exact running Compose db of this project', () => {
    const valid = { id: 'a'.repeat(64), running: true, project: 'worldloom', service: 'db' };
    expect(backupContainer(valid)).toBe(valid.id);
    for (const change of [
      { id: 'a'.repeat(12) },
      { running: false },
      { project: 'other' },
      { service: 'app' }
    ]) {
      expect(() => backupContainer({ ...valid, ...change })).toThrow(BackupDrillError);
    }
  });

  it('pins local noninteractive PostgreSQL targets without opening a process', () => {
    expect(postgresArgs('worldloom', 'worldloom')).toEqual(
      expect.arrayContaining([
        '-X',
        '-w',
        'ON_ERROR_STOP=1',
        '/var/run/postgresql',
        '5432',
        'worldloom'
      ])
    );
    for (const database of [
      'other_project',
      'postgresql://private-sentinel',
      '',
      'worldloom_backup_drill_bad'
    ]) {
      expect(() => postgresArgs('worldloom', database)).toThrow(BackupDrillError);
    }
    expect(() => postgresArgs('role"; DROP', 'worldloom')).toThrow(BackupDrillError);
  });

  it('rejects unsafe, missing, duplicate and unbounded table inventories', () => {
    expect(backupTables(tables.toReversed())).toEqual(tables);
    for (const value of [
      null,
      [],
      ['worlds'],
      [...tables, 'worlds'],
      [...tables, 'private"; DROP'],
      [...tables, ...Array.from({ length: 126 }, (_, index) => `table_${index}`)]
    ]) {
      expect(() => backupTables(value)).toThrow(BackupDrillError);
    }
  });

  it('bounds only the selected container utility, not a shell or shared database backend', () => {
    for (const command of ['pg_dump', 'pg_restore']) {
      expect(postgresUtilityArgs(command, ['-w'])).toEqual([
        'timeout',
        '--signal=TERM',
        '--kill-after=5s',
        '45s',
        command,
        '-w'
      ]);
    }
    for (const command of ['sh', 'psql', 'pg_dump; private-command']) {
      expect(() => postgresUtilityArgs(command, [])).toThrow(BackupDrillError);
    }
    expect(() => postgresUtilityArgs('pg_dump', ['x'.repeat(4097)])).toThrow(BackupDrillError);
    expect(() => postgresUtilityArgs('pg_dump', null)).toThrow(BackupDrillError);
  });

  it('requires PostgreSQL 16, an exported snapshot and supported public-only scope', () => {
    expect(snapshotMetadata(metadata(), 'worldloom')).toEqual({
      tables,
      snapshot: metadata().snapshot
    });
    for (const change of [
      { database: 'other' },
      { serverVersion: '150001' },
      { serverVersion: '170000' },
      { foreignTables: '1' },
      { otherSchemas: ['private_schema'] },
      { snapshot: 'private-snapshot-sentinel' }
    ]) {
      expect(() => snapshotMetadata({ ...metadata(), ...change }, 'worldloom')).toThrow(
        BackupDrillError
      );
    }
    expect(
      snapshotMetadata({ ...metadata(), database: 'temporary', snapshot: null }, 'temporary', {
        exported: false
      }).snapshot
    ).toBeNull();
  });

  it('fixes a read-only snapshot and serialization GUCs without embedding data or SQL identifiers from input', () => {
    const sql = snapshotSQL();
    expect(sql).toContain('REPEATABLE READ READ ONLY');
    expect(sql).toContain('pg_export_snapshot()');
    expect(sql).toContain("nspname !~ '^pg_'");
    expect(sql).toContain("work_mem = '4MB'");
    expect(sql).toContain("statement_timeout = '30s'");
    expect(snapshotSQL(false)).not.toContain('pg_export_snapshot()');
    expect(fingerprintSQL(tables)).toContain("sha256(convert_to(to_jsonb(t)::text, 'UTF8'))");
    expect(fingerprintSQL(tables)).toContain('ORDER BY row_hash COLLATE "C"');
    expect(() => fingerprintSQL([...tables, 'bad"identifier'])).toThrow(BackupDrillError);
  });

  it('counts repeated rows and handles empty tables with a streaming digest', () => {
    const digest = hash('synthetic row');
    const result = fingerprints({ worlds: [digest, digest] });
    expect(result[0]).toEqual({ table: '_prisma_migrations', rows: '0', sha256: hash('') });
    expect(result[2]).toEqual({
      table: 'worlds',
      rows: '2',
      sha256: hash(`${digest}\n${digest}\n`)
    });
  });

  it('rejects row text, unsorted hashes, missing end markers and incorrect table order', () => {
    const reader = fingerprintReader(tables);
    expect(() => reader.line('WL_TABLE:worlds')).toThrow(BackupDrillError);
    reader.line('WL_TABLE:_prisma_migrations');
    expect(() => reader.line('private-body-sentinel')).toThrow(BackupDrillError);
    reader.line('f'.repeat(64));
    expect(() => reader.line('a'.repeat(64))).toThrow(BackupDrillError);
    expect(() => reader.finish()).toThrow(BackupDrillError);
  });

  it('compares actual content including usage, not only equal row counts', () => {
    const source = fingerprints({ llm_usage_calls: [hash('known usage')] });
    expect(() => compareBackup(source, structuredClone(source), tables)).not.toThrow();
    const changed = fingerprints({ llm_usage_calls: [hash('different usage')] });
    expect(source[1].rows).toBe(changed[1].rows);
    expect(() => compareBackup(source, changed, tables)).toThrow(BackupDrillError);
    expect(() => compareBackup(undefined, undefined)).toThrow(BackupDrillError);
    for (const rows of [0, '-1', '01', '1'.repeat(81)]) {
      expect(() =>
        compareBackup(
          source,
          source.map((entry: Record<string, unknown>) => ({ ...entry, rows })),
          tables
        )
      ).toThrow(BackupDrillError);
    }
    const huge = source.map((entry: Record<string, unknown>) => ({
      ...entry,
      rows: '9007199254740993'
    }));
    expect(() => compareBackup(huge, structuredClone(huge), tables)).not.toThrow();
  });
});
