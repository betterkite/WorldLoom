#!/usr/bin/env node

/**
 * 在同一个 PostgreSQL 容器中执行一次可丢弃的备份/恢复演练。
 *
 * 约束：
 * - 只读取 WORLDLOOM_DB_CONTAINER 中的 source database；
 * - 只创建并最终删除一个带前缀的临时 database；
 * - 不覆盖 worldloom、worldloom_test 或任何用户指定名称的 database；
 * - 备份文件只存在于数据库容器的 /tmp，演练结束后清理。
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const container = process.env.WORLDLOOM_DB_CONTAINER ?? 'worldloom-db';
const dbUser = process.env.WORLDLOOM_DB_USER ?? 'worldloom';
const sourceDatabase = process.env.WORLDLOOM_DB_NAME ?? 'worldloom';
const drillSuffix = randomUUID().replaceAll('-', '');
const drillDatabase = `worldloom_backup_drill_${drillSuffix}`;
const backupPath = `/tmp/${drillDatabase}.dump`;

if (!/^worldloom_backup_drill_[a-z0-9_]+$/.test(drillDatabase)) {
  throw new Error('generated drill database name failed the safety check');
}

function docker(args, { capture = false } = {}) {
  try {
    const output = execFileSync('docker', ['exec', container, ...args], {
      encoding: 'utf8',
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    });
    return typeof output === 'string' ? output.trim() : '';
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim();
    const suffix = stderr ? `: ${stderr.slice(-800)}` : '';
    throw new Error(`docker ${args[0] ?? 'command'} failed${suffix}`);
  }
}

function psql(database, sql, { capture = false } = {}) {
  return docker(
    ['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', dbUser, '-d', database, '-At', '-c', sql],
    { capture }
  );
}

function count(database, sql) {
  const value = Number(psql(database, sql, { capture: true }));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`invalid count returned for ${database}`);
  }
  return value;
}

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    docker(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', dbUser, '-d', 'postgres', '-c',
      `DROP DATABASE IF EXISTS "${drillDatabase}";`], { capture: true });
  } catch (error) {
    console.error(`cleanup failed: ${error.message}`);
    process.exitCode = 1;
  }
}

try {
  const sourceTables = count(
    sourceDatabase,
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"
  );
  const sourceWorlds = count(sourceDatabase, 'SELECT count(*) FROM worlds');

  docker(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', dbUser, '-d', 'postgres', '-c',
    `CREATE DATABASE "${drillDatabase}";`], { capture: true });
  psql(drillDatabase, 'CREATE EXTENSION IF NOT EXISTS vector;', { capture: true });
  docker(['pg_dump', '-U', dbUser, '-d', sourceDatabase, '--format=custom', '--file', backupPath], {
    capture: true
  });
  docker([
    'pg_restore',
    '-U',
    dbUser,
    '--exit-on-error',
    '--no-owner',
    '--dbname',
    drillDatabase,
    backupPath
  ], { capture: true });

  const restoredTables = count(
    drillDatabase,
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"
  );
  const restoredWorlds = count(drillDatabase, 'SELECT count(*) FROM worlds');

  if (sourceTables !== restoredTables || sourceWorlds !== restoredWorlds) {
    throw new Error(
      `restore verification mismatch (tables ${sourceTables}/${restoredTables}, worlds ${sourceWorlds}/${restoredWorlds})`
    );
  }

  console.log(JSON.stringify({
    passed: true,
    sourceDatabase,
    temporaryDatabase: drillDatabase,
    tables: restoredTables,
    worlds: restoredWorlds,
    backupPath,
    cleanup: 'temporary database and dump removed'
  }, null, 2));
} finally {
  try {
    docker(['rm', '-f', backupPath], { capture: true });
  } catch (error) {
    console.error(`backup file cleanup failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
}
