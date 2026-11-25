import { createHash } from 'node:crypto';

export class BackupDrillError extends Error {
  constructor(code, recovery = {}) {
    super('WorldLoom backup drill failed; raw command, connection and data values withheld');
    this.name = 'BackupDrillError';
    this.code = code;
    this.recovery = recovery;
  }
}
export function requireBackup(value, code) {
  if (!value) throw new BackupDrillError(code);
}

export function backupOptions(env) {
  const container = env.WORLDLOOM_DB_CONTAINER === undefined ? 'worldloom-db' : env.WORLDLOOM_DB_CONTAINER;
  const dbUser = env.WORLDLOOM_DB_USER === undefined ? 'worldloom' : env.WORLDLOOM_DB_USER;
  const sourceDatabase = env.WORLDLOOM_DB_NAME === undefined ? 'worldloom' : env.WORLDLOOM_DB_NAME;
  requireBackup(typeof container === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container), 'invalid_container');
  requireBackup(typeof dbUser === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(dbUser), 'invalid_db_user');
  requireBackup(['worldloom', 'worldloom_test'].includes(sourceDatabase), 'invalid_source_database');
  return { container, dbUser, sourceDatabase };
}

export function backupResources(uuid) {
  requireBackup(typeof uuid === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid), 'invalid_drill_identity');
  const suffix = uuid.replaceAll('-', '');
  return {
    database: `worldloom_backup_drill_${suffix}`,
    marker: `worldloom-backup-drill:${suffix}`,
    directoryTemplate: `/tmp/worldloom-backup-drill-${suffix}-XXXXXX`,
    directoryPattern: new RegExp(`^/tmp/worldloom-backup-drill-${suffix}-[a-zA-Z0-9]{6}$`),
    ownerFile: `${suffix}.owner`
  };
}

export function backupContainer(value) {
  requireBackup(value && typeof value.id === 'string' && /^[0-9a-f]{64}$/.test(value.id) && value.running === true &&
    value.project === 'worldloom' && value.service === 'db', 'container_scope_mismatch');
  return value.id;
}

const tablePattern = /^[a-z_][a-z0-9_]{0,62}$/;
export function backupTables(value) {
  requireBackup(Array.isArray(value) && value.length > 0 && value.length <= 128 &&
    value.every((table) => typeof table === 'string' && tablePattern.test(table)) &&
    new Set(value).size === value.length && value.includes('worlds') && value.includes('_prisma_migrations'),
  'unsupported_table_inventory');
  return [...value].sort();
}

export function snapshotMetadata(value, database, { exported = true } = {}) {
  requireBackup(value?.database === database && typeof value.serverVersion === 'string' && /^[0-9]+$/.test(value.serverVersion) &&
    Number(value.serverVersion) >= 160000 && Number(value.serverVersion) < 170000 &&
    value.foreignTables === '0' && Array.isArray(value.otherSchemas) && value.otherSchemas.length === 0,
  'unsupported_database_scope');
  if (exported) requireBackup(typeof value.snapshot === 'string' && /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9]{1,10}$/.test(value.snapshot), 'invalid_snapshot');
  return { tables: backupTables(value.tables), snapshot: exported ? value.snapshot : null };
}

// Source/restore hashing happens in a read-only repeatable-read transaction.
// All SQL is fixed or uses identifiers admitted by backupTables; no row data is
// returned, only per-row SHA-256 digests. GUCs fix serialization and bound work.
export function snapshotSQL(exported = true) {
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '90s';
SET LOCAL work_mem = '4MB';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';
SET LOCAL extra_float_digits = 3;
SET LOCAL row_security = off;
SELECT json_build_object(
  'database', current_database(), 'serverVersion', current_setting('server_version_num'),
  'snapshot', ${exported ? 'pg_export_snapshot()' : 'NULL'},
  'tables', COALESCE((SELECT json_agg(c.relname ORDER BY c.relname) FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'm')), '[]'::json),
  'foreignTables', (SELECT COUNT(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'f'),
  'otherSchemas', COALESCE((SELECT json_agg(nspname) FROM pg_namespace
    WHERE nspname !~ '^pg_' AND nspname NOT IN ('public', 'information_schema')), '[]'::json)
);
`;
}

export function fingerprintSQL(tables) {
  return backupTables(tables).map((table) => `\n\\echo WL_TABLE:${table}
SELECT row_hash FROM (
  SELECT encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex') AS row_hash
  FROM public."${table}" AS t
) AS hashes ORDER BY row_hash COLLATE "C";
\\echo WL_TABLE_END
`).join('');
}

/** Incremental transcript parser: never buffer all rows/digests or convert
 * cumulative row counts to Number. Sorting makes physical row order irrelevant.
 */
export function fingerprintReader(tables) {
  const expected = backupTables(tables);
  const results = [];
  let current = null;
  let hash;
  let count = 0n;
  let previous = '';
  return {
    line(value) {
      requireBackup(typeof value === 'string' && value.length <= 100, 'invalid_fingerprint_transcript');
      if (value === `WL_TABLE:${expected[results.length]}`) {
        requireBackup(current === null && results.length < expected.length, 'invalid_fingerprint_transcript');
        current = expected[results.length];
        hash = createHash('sha256');
        count = 0n;
        previous = '';
      } else if (value === 'WL_TABLE_END') {
        requireBackup(current !== null, 'invalid_fingerprint_transcript');
        results.push({ table: current, rows: count.toString(), sha256: hash.digest('hex') });
        current = null;
      } else {
        requireBackup(current !== null && /^[0-9a-f]{64}$/.test(value) && value >= previous, 'invalid_fingerprint_transcript');
        hash.update(`${value}\n`);
        previous = value;
        count += 1n;
      }
    },
    finish() {
      requireBackup(current === null && results.length === expected.length, 'incomplete_fingerprint_transcript');
      return results;
    }
  };
}

export function compareBackup(source, restored, tables) {
  const normalize = (value) => {
    requireBackup(Array.isArray(value), 'invalid_fingerprint_result');
    const inventory = backupTables(value.map((entry) => entry?.table));
    requireBackup(value.every((entry, index) => entry.table === inventory[index] &&
      typeof entry.rows === 'string' && /^(0|[1-9][0-9]{0,79})$/.test(entry.rows) &&
      typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/.test(entry.sha256)), 'invalid_fingerprint_result');
    if (tables) requireBackup(JSON.stringify(inventory) === JSON.stringify(backupTables(tables)), 'invalid_fingerprint_result');
    return value.map(({ table, rows, sha256 }) => ({ table, rows, sha256 }));
  };
  requireBackup(JSON.stringify(normalize(source)) === JSON.stringify(normalize(restored)), 'restore_content_mismatch');
}
