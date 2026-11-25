#!/usr/bin/env node
/** Local PostgreSQL 16 snapshot/restore drill. Importing this file never runs it. */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  BackupDrillError, backupOptions, backupResources, backupContainer,
  compareBackup, requireBackup, snapshotMetadata
} from './backup-drill-contract.mjs';
import { dockerCommand, openSnapshotSession, postgresArgs, postgresUtilityArgs } from './backup-drill-transport.mjs';

const inspectFormat = '{"id":{{json .Id}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}}}';

export async function runBackupRestoreDrill(env = process.env, dependencies = {}) {
  const options = backupOptions(env);
  const resources = backupResources((dependencies.uuid ?? randomUUID)());
  const docker = dependencies.docker ?? dockerCommand;
  const openSnapshot = dependencies.openSnapshot ?? openSnapshotSession;
  let containerId;
  let directory;
  let directoryOwned = false;
  let databaseCreated = false;
  let sourceSession;
  let restoreSession;
  let failure;
  let cleanupFailed = false;
  let source;
  let usagePresent = false;
  const readContainer = async (reference) => {
    let value;
    try { value = JSON.parse(await docker(['inspect', '--format', inspectFormat, reference])); }
    catch { throw new BackupDrillError('container_inspect_failed'); }
    return backupContainer(value);
  };
  const exec = (args, controls) => docker(['exec', containerId, ...args], controls);
  const postgres = (args, controls) => docker(['exec', '-e',
    'PGOPTIONS=-c statement_timeout=60000 -c lock_timeout=5000', '-i', containerId, ...args], controls);
  const sql = (database, query) => postgres(postgresArgs(options.dbUser, database), { input: query });
  const assertDatabaseOwned = async () => {
    const marker = await sql('postgres', `SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = '${resources.database}';`);
    requireBackup(marker === resources.marker, 'database_ownership_unconfirmed');
  };
  const assertDirectoryOwned = async () => {
    requireBackup(resources.directoryPattern.test(directory ?? '') &&
      await exec(['stat', '-c', '%F:%a', directory]) === 'directory:700' &&
      ['regular file:600', 'regular empty file:600'].includes(
        await exec(['stat', '-c', '%F:%a', `${directory}/${resources.ownerFile}`])
      ), 'directory_ownership_unconfirmed');
  };

  try {
    const override = env.DOCKER_HOST;
    requireBackup(override === undefined || /^unix:\/\/\/[^\r\n]+$/.test(override), 'nonlocal_docker');
    const contextHost = JSON.parse(await docker(['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']));
    requireBackup(typeof contextHost === 'string' && /^unix:\/\/\/[^\r\n]+$/.test(contextHost), 'nonlocal_docker');
    containerId = await readContainer(options.container);
    requireBackup((await exec(['timeout', '--version'])).startsWith('timeout (GNU coreutils) '),
      'unsupported_container_timeout');
    const createdDirectory = await exec(['mktemp', '-d', resources.directoryTemplate]);
    requireBackup(resources.directoryPattern.test(createdDirectory), 'invalid_dump_directory');
    directory = createdDirectory;
    directoryOwned = true;
    await exec(['touch', `${directory}/${resources.ownerFile}`]);
    await exec(['chmod', '600', `${directory}/${resources.ownerFile}`]);
    await assertDirectoryOwned();

    sourceSession = openSnapshot(containerId, options.dbUser, options.sourceDatabase);
    const metadata = snapshotMetadata(await sourceSession.metadata(true), options.sourceDatabase);
    source = await sourceSession.fingerprints(metadata.tables);
    usagePresent = metadata.tables.includes('llm_usage_calls');
    await postgres(postgresUtilityArgs('pg_dump', ['-w', '-h', '/var/run/postgresql', '-p', '5432', '-U', options.dbUser,
      '-d', options.sourceDatabase, '--format=custom', `--snapshot=${metadata.snapshot}`,
      '--lock-wait-timeout=5000', '--file', `${directory}/backup.dump`]), { capture: false });
    // Keep the exporting transaction open until pg_dump finishes, then release
    // it immediately: restoration does not need source locks or the snapshot.
    await sourceSession.close();
    sourceSession = null;

    await sql('postgres', `CREATE DATABASE "${resources.database}" WITH TEMPLATE template0;`);
    databaseCreated = true;
    await sql('postgres', `COMMENT ON DATABASE "${resources.database}" IS '${resources.marker}';`);
    await assertDatabaseOwned();
    await postgres(postgresUtilityArgs('pg_restore', ['-w', '-h', '/var/run/postgresql', '-p', '5432', '-U', options.dbUser,
      '--exit-on-error', '--no-owner', '--dbname', resources.database, `${directory}/backup.dump`]), { capture: false });
    await assertDatabaseOwned();
    restoreSession = openSnapshot(containerId, options.dbUser, resources.database);
    const restored = snapshotMetadata(await restoreSession.metadata(false), resources.database, { exported: false });
    requireBackup(JSON.stringify(restored.tables) === JSON.stringify(metadata.tables), 'restore_inventory_mismatch');
    compareBackup(source, await restoreSession.fingerprints(restored.tables), metadata.tables);
    await restoreSession.close();
    restoreSession = null;
  } catch (error) {
    failure = error instanceof BackupDrillError ? error.code : 'backup_drill_failed';
  } finally {
    for (const session of [restoreSession, sourceSession]) {
      if (session) try { await session.close(); } catch { cleanupFailed = true; }
    }
    // Recheck the original exact ID, never a replacement under the same name.
    let scopeConfirmed = false;
    if (containerId) try { scopeConfirmed = await readContainer(containerId) === containerId; } catch { cleanupFailed = true; }
    if (databaseCreated) {
      try {
        requireBackup(scopeConfirmed, 'container_scope_changed');
        await assertDatabaseOwned();
        // No IF EXISTS, FORCE, prefix search, source DROP or backend termination.
        await sql('postgres', `DROP DATABASE "${resources.database}";`);
        requireBackup(await sql('postgres', `SELECT COUNT(*)::text FROM pg_database WHERE datname = '${resources.database}';`) === '0', 'database_cleanup_unconfirmed');
      } catch { cleanupFailed = true; }
    }
    if (directoryOwned) {
      try {
        requireBackup(scopeConfirmed, 'container_scope_changed');
        await assertDirectoryOwned();
        await exec(['rm', '-f', `${directory}/backup.dump`]);
        await exec(['rm', `${directory}/${resources.ownerFile}`]);
        await exec(['rmdir', directory]); // Fail on unexpected contents, no rm -r.
      } catch { cleanupFailed = true; }
    }
  }
  // These are exact candidate targets for operator reconciliation, not a claim
  // that they exist. A failed Docker acknowledgement may hide a completed write.
  const recovery = { containerId: containerId ?? null,
    temporaryDatabase: resources.database, privateDumpDirectory: directory ?? null };
  if (failure || cleanupFailed) throw new BackupDrillError(cleanupFailed ? 'cleanup_unconfirmed' : failure, recovery);
  return {
    reportVersion: 'worldloom.backup-drill/v2', passed: true, scope: 'local-same-cluster-public-table-data',
    sourceDatabase: options.sourceDatabase, temporaryDatabase: resources.database,
    tables: source, usageTablePresent: usagePresent,
    usageRestoreStatus: usagePresent ? 'row-content-compared' : 'not-present-in-source-snapshot',
    cleanup: { temporaryDatabase: 'removed', privateDumpDirectory: 'removed', snapshotSessions: 'closed' },
    durableBackup: false, releaseApproved: false
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    requireBackup(process.argv.slice(2).filter((value) => value !== '--').length === 0, 'unsupported_argument');
    console.log(JSON.stringify(await runBackupRestoreDrill(), null, 2));
  } catch (error) {
    const safe = error instanceof BackupDrillError ? error : new BackupDrillError('backup_drill_failed');
    console.error(JSON.stringify({ passed: false, code: safe.code, recovery: safe.recovery, releaseApproved: false }));
    process.exitCode = 1;
  }
}
