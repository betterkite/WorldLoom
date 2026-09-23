export const DEFAULT_WORKER_MAX_CONCURRENCY = 4;
export const MAX_WORKER_CONCURRENCY = 32;
export const MAX_AUTOMATIC_WORKER_RECOVERIES = 3;

export function parseWorkerMaxConcurrency(value: string | undefined): number {
  if (value === undefined) return DEFAULT_WORKER_MAX_CONCURRENCY;
  if (!/^[0-9]+$/.test(value)) {
    throw new Error('WORLDLOOM_WORKER_MAX_CONCURRENCY must be an integer from 1 to 32');
  }
  const concurrency = Number(value);
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > MAX_WORKER_CONCURRENCY
  ) {
    throw new Error('WORLDLOOM_WORKER_MAX_CONCURRENCY must be an integer from 1 to 32');
  }
  return concurrency;
}
