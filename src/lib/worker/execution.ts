import { parseWorkerMaxConcurrency } from './policy';

/** A process-wide FIFO gate shared by API and polling-worker executors. */
export function createExecutionLimiter(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid execution limit');
  let active = 0;
  const waiting: (() => void)[] = [];
  const releaseHandle = () => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    };
  };
  return {
    acquire(): Promise<() => void> {
      if (active < limit) {
        active += 1;
        return Promise.resolve(releaseHandle());
      }
      return new Promise((resolve) => waiting.push(() => resolve(releaseHandle())));
    },
    snapshot: () => ({ active, waiting: waiting.length, limit })
  };
}

type ExecutionGlobal = typeof globalThis & {
  worldloomExecutionLimiter?: ReturnType<typeof createExecutionLimiter>;
};
const executionGlobal = globalThis as ExecutionGlobal;

export function getExecutionLimiter() {
  return (executionGlobal.worldloomExecutionLimiter ??= createExecutionLimiter(
    parseWorkerMaxConcurrency(process.env.WORLDLOOM_WORKER_MAX_CONCURRENCY)
  ));
}
