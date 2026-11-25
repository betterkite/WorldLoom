import { spawn } from 'node:child_process';
import { BackupDrillError, fingerprintReader, fingerprintSQL, requireBackup, snapshotSQL } from './backup-drill-contract.mjs';

const COMMAND_MS = 60_000;
const OUTPUT_BYTES = 64 * 1024;

// pg_dump/pg_restore reset statement_timeout themselves. Bound their own
// container-side process group, not just the host Docker client. Reserve time
// for TERM + KILL to be acknowledged before the client's 60-second deadline.
// This does not attest that a PostgreSQL backend query has stopped.
export function postgresUtilityArgs(command, args) {
  requireBackup(['pg_dump', 'pg_restore'].includes(command) && Array.isArray(args) &&
    args.length < 128 && args.every((arg) => typeof arg === 'string' && arg.length <= 4096),
  'invalid_postgres_utility');
  return ['timeout', '--signal=TERM', '--kill-after=5s', '45s', command, ...args];
}

/** No shell, inherited command output or raw stderr in reports. Killing a
 * Docker client does not attest that the container exec ended. SQL sessions
 * also have server deadlines, and unconfirmed cleanup must prevent PASS.
 */
export function dockerCommand(args, { input = '', capture = true } = {}) {
  requireBackup(process.env.DOCKER_HOST === undefined || /^unix:\/\/\/[^\r\n]+$/.test(process.env.DOCKER_HOST), 'nonlocal_docker');
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let failed = false;
    let size = 0;
    const chunks = [];
    const fail = () => {
      failed = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      reject(new BackupDrillError('docker_command_failed'));
    };
    const timer = setTimeout(fail, COMMAND_MS);
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.stdout.on('error', fail);
    child.stderr.on('error', fail);
    child.stdout.on('data', (chunk) => {
      if (!capture) return;
      size += chunk.length;
      if (size > OUTPUT_BYTES) fail();
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (failed || code !== 0 || signal) reject(new BackupDrillError('docker_command_failed'));
      else resolve(Buffer.concat(chunks).toString('utf8').trim());
    });
    child.stdin.end(input);
  });
}

export function postgresArgs(user, database) {
  // Pin local socket/port and disable password prompts. Never inherit a PGHOST
  // redirection or treat an operator-provided name as a libpq connection string.
  requireBackup(typeof user === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(user) &&
    typeof database === 'string' && /^(postgres|worldloom|worldloom_test|worldloom_backup_drill_[0-9a-f]{32})$/.test(database),
  'invalid_postgres_target');
  return ['psql', '-X', '-q', '-w', '-v', 'ON_ERROR_STOP=1', '-h', '/var/run/postgresql',
    '-p', '5432', '-U', user, '-d', database, '-At'];
}

export function openSnapshotSession(containerId, user, database) {
  requireBackup(process.env.DOCKER_HOST === undefined || /^unix:\/\/\/[^\r\n]+$/.test(process.env.DOCKER_HOST), 'nonlocal_docker');
  requireBackup(typeof containerId === 'string' && /^[0-9a-f]{64}$/.test(containerId), 'invalid_container_identity');
  const child = spawn('docker', ['exec', '-i', containerId, ...postgresArgs(user, database)], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let pending = null;
  let carry = '';
  let ended = false;
  let closing = false;
  let aborted = false;
  let terminal;
  const closed = new Promise((resolve) => { terminal = resolve; });
  const stop = () => {
    aborted = true;
    clearTimeout(lifetime);
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new BackupDrillError('snapshot_session_failed'));
      pending = null;
    }
    child.kill('SIGKILL');
  };
  const lifetime = setTimeout(stop, 300_000);
  child.on('error', stop);
  child.stdin.on('error', stop);
  child.stdout.on('error', stop);
  child.stderr.on('error', stop);
  child.stderr.resume();
  child.stdout.on('data', (chunk) => {
    try {
      requireBackup(chunk.length <= 256 * 1024, 'invalid_snapshot_output');
      carry += chunk.toString('utf8');
      let newline;
      while ((newline = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, newline).replace(/\r$/, '');
        carry = carry.slice(newline + 1);
        requireBackup(line.length <= OUTPUT_BYTES && pending, 'invalid_snapshot_output');
        if (line === 'WL_READY') {
          clearTimeout(pending.timer);
          const resolve = pending.resolve;
          pending = null;
          resolve();
        } else pending.line(line);
      }
      requireBackup(carry.length <= OUTPUT_BYTES, 'invalid_snapshot_output');
    } catch { stop(); }
  });
  child.on('close', (code, signal) => {
    ended = true;
    clearTimeout(lifetime);
    terminal({ code, signal });
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new BackupDrillError('snapshot_session_failed'));
      pending = null;
    }
  });

  const request = (sql, line) => new Promise((resolve, reject) => {
    if (ended || closing || aborted || pending) {
      reject(new BackupDrillError('snapshot_session_unavailable'));
      return;
    }
    pending = { resolve, reject, line, timer: setTimeout(stop, COMMAND_MS) };
    child.stdin.write(`${sql}\n\\echo WL_READY\n`);
  });

  return {
    async metadata(exported = true) {
      const lines = [];
      await request(snapshotSQL(exported), (line) => {
        requireBackup(lines.length === 0, 'invalid_snapshot_metadata');
        lines.push(line);
      });
      try { return JSON.parse(lines[0]); } catch { throw new BackupDrillError('invalid_snapshot_metadata'); }
    },
    async fingerprints(tables) {
      const reader = fingerprintReader(tables);
      await request(fingerprintSQL(tables), (line) => reader.line(line));
      return reader.finish();
    },
    async close() {
      if (pending) stop();
      if (!ended) {
        closing = true;
        child.stdin.end('ROLLBACK;\n\\q\n');
      }
      let timer;
      try {
        const result = await Promise.race([
          closed,
          new Promise((resolve) => { timer = setTimeout(() => { stop(); resolve(null); }, 5_000); })
        ]);
        requireBackup(!aborted && result?.code === 0 && !result.signal && carry === '', 'snapshot_close_failed');
      } finally {
        if (timer) clearTimeout(timer);
        clearTimeout(lifetime);
      }
    }
  };
}
