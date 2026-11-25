import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const worker = vi.hoisted(() => ({ loaded: vi.fn(), start: vi.fn() }));
vi.mock('@/lib/worker/background', () => {
  worker.loaded();
  return { startBackgroundWorker: worker.start };
});
import { register } from '@/instrumentation';

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

describe('runtime-specific worker registration', () => {
  it.each([
    [undefined, undefined],
    [undefined, 'true'],
    ['edge', undefined],
    ['edge', 'true'],
    ['nodejs', undefined],
    ['nodejs', 'false'],
    ['nodejs', 'TRUE']
  ])('does not load or start the worker for runtime=%s, flag=%s', async (runtime, flag) => {
    vi.stubEnv('NEXT_RUNTIME', runtime);
    vi.stubEnv('WORLDLOOM_WORKER', flag);
    await register();
    expect(worker.loaded).not.toHaveBeenCalled();
    expect(worker.start).not.toHaveBeenCalled();
  });

  it('loads and starts the worker in Node only when explicitly enabled', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('WORLDLOOM_WORKER', 'true');
    await register();
    expect(worker.loaded).toHaveBeenCalledOnce();
    expect(worker.start).toHaveBeenCalledOnce();
  });
});
