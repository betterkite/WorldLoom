import { describe, expect, it } from 'vitest';
import { createExecutionLimiter } from '@/lib/worker/execution';

describe('API and worker execution gate', () => {
  it('shares bounded FIFO slots and makes release idempotent', async () => {
    const limiter = createExecutionLimiter(1);
    const first = await limiter.acquire();
    const order: string[] = [];
    const second = limiter.acquire().then((release) => {
      order.push('API');
      return release;
    });
    const third = limiter.acquire().then((release) => {
      order.push('worker');
      return release;
    });
    expect(limiter.snapshot()).toEqual({ active: 1, waiting: 2, limit: 1 });
    first();
    first();
    const releaseSecond = await second;
    expect(order).toEqual(['API']);
    expect(limiter.snapshot()).toEqual({ active: 1, waiting: 1, limit: 1 });
    releaseSecond();
    const releaseThird = await third;
    expect(order).toEqual(['API', 'worker']);
    releaseThird();
    expect(limiter.snapshot()).toEqual({ active: 0, waiting: 0, limit: 1 });
  });

  it('never exceeds the cap under a mixed burst and releases failed work', async () => {
    const limiter = createExecutionLimiter(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 51 }, async (_, index) => {
        const release = await limiter.acquire();
        try {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          if (index % 3 === 0) throw new Error('synthetic task failure');
        } catch {
          // Exercise the executor's finally path.
        } finally {
          active -= 1;
          release();
        }
      })
    );
    expect(peak).toBe(2);
    expect(limiter.snapshot()).toEqual({ active: 0, waiting: 0, limit: 2 });
  });

  it('rejects unsafe caps', () => {
    for (const cap of [0, -1, 1.5, NaN]) expect(() => createExecutionLimiter(cap)).toThrow();
  });
});
