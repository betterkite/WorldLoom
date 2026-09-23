import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MEMORY_UNITS = new Map([
  ['b', 1],
  ['kb', 1_000],
  ['kib', 1_024],
  ['mb', 1_000 ** 2],
  ['mib', 1_024 ** 2],
  ['gb', 1_000 ** 3],
  ['gib', 1_024 ** 3],
  ['tb', 1_000 ** 4],
  ['tib', 1_024 ** 4]
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ANSI_CONTROL_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export function parseMemoryValue(value) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|KiB|MB|MiB|GB|GiB|TB|TiB)$/i);
  if (!match) throw new Error(`unsupported Docker memory value: ${value}`);
  const multiplier = MEMORY_UNITS.get(match[2].toLowerCase());
  if (!multiplier) throw new Error(`unsupported Docker memory unit: ${match[2]}`);
  return Number(match[1]) * multiplier;
}

export function parseDockerStatsSnapshot(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [containerId, name, memoryUsage] = line.split('\t');
      if (!containerId || !name || !memoryUsage) {
        throw new Error('invalid Docker stats row');
      }
      const [used, limit] = memoryUsage.split('/').map((value) => value.trim());
      if (!used || !limit) throw new Error('invalid Docker memory usage');
      return {
        containerId,
        name,
        usedBytes: parseMemoryValue(used),
        limitBytes: parseMemoryValue(limit)
      };
    });
}

function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return loopback && port === '4310';
  } catch {
    return false;
  }
}

function unavailable(reason) {
  return {
    stop: async () => ({
      available: false,
      reason,
      source: 'docker stats streaming'
    })
  }
}

/**
 * Sample app/db/worker container memory for local Compose benchmarks only.
 * @param {{ baseUrl?: string, startupTimeoutMs?: number }} options
 */
export async function startDockerMemorySampler({ baseUrl, startupTimeoutMs = 8_000 } = {}) {
  if (!isLoopbackUrl(baseUrl ?? '')) {
    return unavailable('benchmark target is not the local Compose loopback port 4310');
  }

  let containerIds;
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['compose', '--profile', 'full', 'ps', '-q', 'app', 'db', 'worker'],
      { timeout: 5_000, maxBuffer: 1024 * 1024 }
    );
    containerIds = stdout.split(/\s+/).filter(Boolean);
  } catch {
    return unavailable('Docker Compose containers could not be discovered');
  }
  if (!containerIds.length) return unavailable('no local app/db/worker containers are running');

  const containers = new Map();
  const expectedIds = new Set(containerIds.map((containerId) => containerId.slice(0, 12)));
  let samplingErrors = 0;
  const samplingStartedAt = Date.now();
  const statsProcess = spawn(
    'docker',
    ['stats', '--format', '{{.ID}}\t{{.Name}}\t{{.MemUsage}}', ...containerIds],
    { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' } }
  );
  let processClosed = false;
  let samplingEndedAt = null;
  let closeResolve;
  const closePromise = new Promise((resolve) => {
    closeResolve = resolve;
  });
  statsProcess.once('close', (code, signal) => {
    processClosed = true;
    samplingEndedAt = Date.now();
    closeResolve({ code, signal });
  });

  let outputBuffer = '';
  let initialResolve;
  const initialSample = new Promise((resolve) => {
    initialResolve = resolve;
  });
  let initialSettled = false;
  const settleInitial = (ready) => {
    if (initialSettled) return;
    initialSettled = true;
    initialResolve(ready);
  };

  statsProcess.stdout.setEncoding('utf8');
  statsProcess.stdout.on('data', (chunk) => {
    outputBuffer += chunk.replace(ANSI_CONTROL_SEQUENCE, '');
    const lines = outputBuffer.split(/\r?\n/);
    outputBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        for (const row of parseDockerStatsSnapshot(line)) {
          const previous = containers.get(row.containerId);
          containers.set(row.containerId, {
            containerId: row.containerId,
            name: row.name,
            baselineBytes: previous?.baselineBytes ?? row.usedBytes,
            sampledPeakBytes: Math.max(previous?.sampledPeakBytes ?? 0, row.usedBytes),
            limitBytes: row.limitBytes,
            samples: (previous?.samples ?? 0) + 1
          });
        }
      } catch {
        samplingErrors += 1;
      }
      if ([...expectedIds].every((containerId) => containers.has(containerId))) {
        settleInitial(true);
      }
    }
  });
  statsProcess.once('error', () => {
    samplingErrors += 1;
    settleInitial(false);
  });
  statsProcess.once('close', () => settleInitial(false));

  let startupTimer;
  const started = await Promise.race([
    initialSample,
    new Promise((resolve) => {
      startupTimer = setTimeout(() => resolve(false), startupTimeoutMs);
    })
  ]);
  clearTimeout(startupTimer);
  if (!started) {
    if (!processClosed) statsProcess.kill('SIGINT');
    await Promise.race([closePromise, sleep(1_000)]);
    if (!processClosed) {
      statsProcess.kill('SIGKILL');
      await closePromise;
    }
    if (!containers.size) return unavailable('Docker stats returned no container memory rows');
  }

  return {
    stop: async () => {
      if (!processClosed) statsProcess.kill('SIGINT');
      await Promise.race([closePromise, sleep(1_000)]);
      if (!processClosed) {
        statsProcess.kill('SIGKILL');
        await closePromise;
      }
      const samplingWindowSeconds = Number(
        (((samplingEndedAt ?? Date.now()) - samplingStartedAt) / 1000).toFixed(2)
      );
      const missingContainerIds = [...expectedIds].filter((id) => !containers.has(id));
      return {
        available: containers.size > 0,
        source: 'docker stats streaming',
        expectedContainers: expectedIds.size,
        observedContainers: containers.size,
        complete: missingContainerIds.length === 0,
        missingContainerIds,
        samplingWindowSeconds,
        peakIsSampled: true,
        samplingErrors,
        containers: [...containers.values()].map((container) => ({
          containerId: container.containerId,
          name: container.name,
          baselineMiB: Number((container.baselineBytes / 1024 ** 2).toFixed(1)),
          sampledPeakMiB: Number((container.sampledPeakBytes / 1024 ** 2).toFixed(1)),
          sampledDeltaMiB: Number(
            ((container.sampledPeakBytes - container.baselineBytes) / 1024 ** 2).toFixed(1)
          ),
          limitMiB: Number((container.limitBytes / 1024 ** 2).toFixed(1)),
          samples: container.samples
        }))
      };
    }
  };
}
