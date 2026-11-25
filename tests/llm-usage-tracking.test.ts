import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  execute: vi.fn(),
  query: vi.fn(),
  transactionExecute: vi.fn(),
  transaction: vi.fn()
}));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    $executeRaw: storage.execute,
    $queryRaw: storage.query,
    $transaction: storage.transaction
  }
}));

import {
  beginLlmUsageAttempt,
  finishLlmUsageAttempt,
  readLlmUsageSummary
} from '@/lib/llm/usage-tracking';

beforeEach(() => {
  storage.execute.mockReset().mockResolvedValue(1);
  storage.query.mockReset().mockResolvedValue([]);
  storage.transactionExecute.mockReset().mockResolvedValue(0);
  storage.transaction.mockReset().mockImplementation((callback) =>
    callback({
      $executeRaw: storage.transactionExecute,
      $queryRaw: storage.query
    })
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('observational persistent LLM usage', () => {
  it('records only identifiers/time/tokens, with non-regressing SQL upserts', async () => {
    const attempt = await beginLlmUsageAttempt({
      id: 'public-profile',
      model: 'mock-model'
    });
    await finishLlmUsageAttempt(attempt, { inputTokens: 10, outputTokens: 20 }, true);

    expect(storage.execute).toHaveBeenCalledTimes(2);
    const [startSql, ...startArgs] = storage.execute.mock.calls[0];
    const [finishSql, ...finishArgs] = storage.execute.mock.calls[1];
    expect(startSql.join('')).toContain('ON CONFLICT ("id") DO NOTHING');
    expect(finishSql.join('')).toContain('WHERE "llm_usage_calls"."status" = \'pending\'');
    expect(startArgs).toEqual([attempt.id, 'public-profile', 'mock-model', attempt.startedAt]);
    expect(finishArgs).toEqual([
      attempt.id,
      'public-profile',
      'mock-model',
      attempt.startedAt,
      expect.any(Date),
      'completed',
      BigInt(10),
      BigInt(20)
    ]);
  });

  it.each([
    null,
    { inputTokens: -1, outputTokens: 2 },
    { inputTokens: 9007199254740992, outputTokens: 2 }
  ])('stores unknown usage as null, never a fabricated zero: %j', async (usage) => {
    const attempt = await beginLlmUsageAttempt({ id: 'mock', model: 'mock' });
    await finishLlmUsageAttempt(attempt, usage, false);

    const parameters = storage.execute.mock.calls[1].slice(1);
    expect(parameters.slice(-3)).toEqual(['failed', null, null]);
  });

  it('preserves valid usage from a failed/empty completion attempt', async () => {
    const attempt = await beginLlmUsageAttempt({ id: 'mock', model: 'mock' });
    await finishLlmUsageAttempt(attempt, { inputTokens: 5, outputTokens: 7 }, false);

    expect(storage.execute.mock.calls[1].slice(-3)).toEqual(['failed', BigInt(5), BigInt(7)]);
  });

  it('does not block for synchronous or asynchronous storage failures and exposes a safe diagnostic', async () => {
    const before = await readLlmUsageSummary();
    storage.execute.mockImplementationOnce(() => {
      throw new Error('private-database-sentinel');
    });
    const attempt = await beginLlmUsageAttempt({ id: 'mock', model: 'mock' });
    storage.execute.mockRejectedValueOnce(new Error('private-database-sentinel'));
    await expect(finishLlmUsageAttempt(attempt, null, false)).resolves.toBeUndefined();
    const after = await readLlmUsageSummary();

    expect(BigInt(after.recording.currentProcessWriteFailures)).toBe(
      BigInt(before.recording.currentProcessWriteFailures) + BigInt(2)
    );
    expect(console.warn).toHaveBeenCalledWith('[llm-usage] usage_recording_unavailable');
    expect(JSON.stringify(after)).not.toContain('private-database-sentinel');
  });

  it('bounds the wait for a stalled write without rejecting the model attempt', async () => {
    vi.useFakeTimers();
    storage.execute.mockImplementation(() => new Promise(() => {}));
    const beginning = beginLlmUsageAttempt({ id: 'mock', model: 'mock' });
    await vi.advanceTimersByTimeAsync(1_001);
    const attempt = await beginning;
    const finishing = finishLlmUsageAttempt(attempt, { inputTokens: 1, outputTokens: 2 }, true);
    await vi.advanceTimersByTimeAsync(1_001);

    await expect(finishing).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('reads only grouped counters, preserving big sums and unknown attempts across models', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    storage.query.mockResolvedValue([
      {
        profileId: 'mock',
        model: 'first',
        startedAt: new Date('2026-09-30T00:00:00Z'),
        calls: '3',
        knownUsageCalls: '2',
        pendingCalls: '1',
        failedCalls: '1',
        inputTokens: '9007199254740993',
        outputTokens: '7'
      },
      {
        profileId: 'mock',
        model: 'second',
        startedAt: new Date('2026-10-01T00:00:00Z'),
        calls: '1',
        knownUsageCalls: '0',
        pendingCalls: '0',
        failedCalls: '1',
        inputTokens: null,
        outputTokens: null
      }
    ]);
    const summary = await readLlmUsageSummary();

    expect(summary.totals).toEqual({
      calls: '4',
      knownUsageCalls: '2',
      unknownUsageCalls: '2',
      pendingCalls: '1',
      failedCalls: '2',
      inputTokens: '9007199254740993',
      outputTokens: '7',
      totalTokens: '9007199254741000'
    });
    expect(summary.recordedFrom).toBe('2026-09-30T00:00:00.000Z');
    expect(storage.transaction).toHaveBeenCalledTimes(1);
    expect(storage.transaction.mock.calls[0][1]).toEqual({ maxWait: 1_000, timeout: 5_000 });
    expect(storage.transactionExecute.mock.calls.map(([sql]) => sql.join(''))).toEqual([
      'SET TRANSACTION READ ONLY',
      "SET LOCAL statement_timeout = '3s'",
      "SET LOCAL lock_timeout = '1s'"
    ]);
    expect(storage.query).toHaveBeenCalledTimes(1);
    expect(storage.query.mock.calls[0][0].join('')).toContain('GROUP BY "profileId", "model"');
    expect(storage.transactionExecute.mock.invocationCallOrder[2]).toBeLessThan(
      storage.query.mock.invocationCallOrder[0]
    );
    expect(storage.execute).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports no complete usage when there are no recorded calls', async () => {
    const summary = await readLlmUsageSummary();

    expect(summary.totals.calls).toBe('0');
    expect(summary.totals.totalTokens).toBeNull();
    expect(summary.recordedFrom).toBeNull();
    expect(summary.scope).toBe('local-recorded-chat-attempts');
  });

  it.each(['acquire-sync', 'acquire-async', 'configure', 'query'])(
    'fails closed without SQL details, zero totals or retry on %s failure',
    async (stage) => {
      const privateError = new Error('private-sql-connection-sentinel');
      if (stage === 'acquire-sync')
        storage.transaction.mockImplementationOnce(() => {
          throw privateError;
        });
      if (stage === 'acquire-async') storage.transaction.mockRejectedValueOnce(privateError);
      if (stage === 'configure') storage.transactionExecute.mockRejectedValueOnce(privateError);
      if (stage === 'query') storage.query.mockRejectedValueOnce(privateError);
      const error = await readLlmUsageSummary().catch((failure: unknown) => failure);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('LLM usage read unavailable.');
      expect(error).not.toHaveProperty('cause');
      expect(error).not.toHaveProperty('totals');
      expect(storage.transaction).toHaveBeenCalledTimes(1);
      expect(storage.execute).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
      if (stage !== 'query') expect(storage.query).not.toHaveBeenCalled();
    }
  );

  it('clears the application timer when a read succeeds or fails promptly', async () => {
    vi.useFakeTimers();
    await readLlmUsageSummary();
    expect(vi.getTimerCount()).toBe(0);
    storage.query.mockRejectedValueOnce(new Error('private-sentinel'));
    await expect(readLlmUsageSummary()).rejects.toThrow('LLM usage read unavailable.');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a stalled transaction acquisition and never starts SQL after the wait expires', async () => {
    vi.useFakeTimers();
    let acquire!: () => void;
    storage.transaction.mockImplementationOnce(
      (callback) =>
        new Promise((resolve) => {
          acquire = () =>
            resolve(
              callback({
                $executeRaw: storage.transactionExecute,
                $queryRaw: storage.query
              })
            );
        })
    );
    let settled = false;
    const result = readLlmUsageSummary().then(
      () => {
        settled = true;
        return 'unexpected-success';
      },
      (error: Error) => {
        settled = true;
        return error.message;
      }
    );
    await vi.advanceTimersByTimeAsync(6_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe('LLM usage read unavailable.');
    acquire();
    await vi.advanceTimersByTimeAsync(0);

    expect(storage.transactionExecute).not.toHaveBeenCalled();
    expect(storage.query).not.toHaveBeenCalled();
    expect(storage.transaction).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start the next SET or query after a stalled configuration resumes late', async () => {
    vi.useFakeTimers();
    let finishSet!: () => void;
    storage.transactionExecute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSet = () => resolve(0);
        })
    );
    const result = readLlmUsageSummary().catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await result).toBe('LLM usage read unavailable.');
    finishSet();
    await vi.advanceTimersByTimeAsync(0);

    expect(storage.transactionExecute).toHaveBeenCalledTimes(1);
    expect(storage.query).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['resolve', 'reject'])(
    'observes late query %s without publishing fabricated totals or retrying',
    async (settlement) => {
      vi.useFakeTimers();
      let finishQuery!: () => void;
      storage.query.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finishQuery = () =>
              settlement === 'resolve' ? resolve([]) : reject(new Error('private-late-sentinel'));
          })
      );
      const result = readLlmUsageSummary().catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(7_000);
      expect(await result).toBe('LLM usage read unavailable.');
      finishQuery();
      await vi.advanceTimersByTimeAsync(0);

      expect(await result).toBe('LLM usage read unavailable.');
      expect(storage.query).toHaveBeenCalledTimes(1);
      expect(storage.transaction).toHaveBeenCalledTimes(1);
      expect(storage.execute).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  );
});
