import { execFile } from 'node:child_process';
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
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

function unavailable(reason) {
  return {
    stop: async () => ({
      available: false,
      reason,
      source: 'docker stats --no-stream'
    })
  };
}

/** Sample app/db/worker container memory for local Compose benchmarks only. */
export async function startDockerMemorySampler({ baseUrl, intervalMs = 250 } = {}) {
  if (!isLoopbackUrl(baseUrl ?? '')) return unavailable('benchmark target is not loopback');

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
  let samplingErrors = 0;
  const sample = async () => {
    try {
      const { stdout } = await execFileAsync(
        'docker',
        [
          'stats',
          '--no-stream',
          '--format',
          '{{.ID}}\t{{.Name}}\t{{.MemUsage}}',
          ...containerIds
        ],
        { timeout: 5_000, maxBuffer: 1024 * 1024 }
      );
      for (const row of parseDockerStatsSnapshot(stdout)) {
        const previous = containers.get(row.containerId);
        containers.set(row.containerId, {
          containerId: row.containerId,
          name: row.name,
          baselineBytes: previous?.baselineBytes ?? row.usedBytes,
          sampledPeakBytes: Math.max(previous?.sampledPeakBytes ?? 0, row.usedBytes),
          latestBytes: row.usedBytes,
          limitBytes: row.limitBytes,
          samples: (previous?.samples ?? 0) + 1
        });
      }
    } catch {
      samplingErrors += 1;
    }
  };

  await sample();
  if (!containers.size) return unavailable('Docker stats returned no container memory rows');
  const samplingStartedAt = Date.now();

  let active = true;
  const samplingLoop = (async () => {
    while (active) {
      await sleep(intervalMs);
      if (active) await sample();
    }
  })();

  return {
    stop: async () => {
      active = false;
      await samplingLoop;
      await sample();
      const samplingWindowSeconds = Number(((Date.now() - samplingStartedAt) / 1000).toFixed(2));
      return {
        available: containers.size > 0,
        source: 'docker stats --no-stream',
        pollDelayMs: intervalMs,
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
