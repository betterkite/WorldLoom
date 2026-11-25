import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchLlmUsage,
  LlmUsageReadError,
  LLM_USAGE_READ_TIMEOUT_MS,
  LLM_USAGE_RESPONSE_MAX_BYTES
} from '@/features/worlds/api/usage';

function fixture() {
  const totals = {
    calls: '1',
    knownUsageCalls: '1',
    unknownUsageCalls: '0',
    pendingCalls: '0',
    failedCalls: '0',
    inputTokens: '9007199254740993',
    outputTokens: '2',
    totalTokens: '9007199254740995'
  };
  return {
    scope: 'local-recorded-chat-attempts',
    recordedFrom: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T01:00:00.000Z',
    totals,
    profiles: [{ profileId: 'mock', model: 'mock-only', ...totals }],
    recording: { currentProcessWriteFailures: '0' }
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('bounded cumulative usage reads (no database or provider)', () => {
  it('returns the whole validated snapshot, preserves exact tokens and cleans up its timer/listener', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(fixture())));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fetchLlmUsage({ signal: caller.signal })).resolves.toEqual(fixture());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/llm/usage', {
      cache: 'no-store',
      signal: expect.any(AbortSignal)
    });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['sync', 'async'])(
    'sanitizes a %s network failure without retaining a private cause',
    async (mode) => {
      const privateError = new Error('private-usage-response-sentinel');
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          if (mode === 'sync') throw privateError;
          return Promise.reject(privateError);
        })
      );
      let error: unknown;
      try {
        await fetchLlmUsage();
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(LlmUsageReadError);
      expect((error as LlmUsageReadError).code).toBe('unavailable');
      expect((error as Error).message).toBe('累计模型用量暂时无法读取');
      expect(error).not.toHaveProperty('cause');
      expect(String(error)).not.toContain('private-usage-response-sentinel');
    }
  );

  it.each([
    new TextEncoder().encode('<private-usage-response-sentinel>'),
    new Uint8Array([0xc3, 0x28])
  ])('sanitizes malformed JSON/UTF-8 before it reaches a query error (case %#)', async (bytes) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes))
    );
    await expect(fetchLlmUsage()).rejects.toMatchObject({
      code: 'invalid',
      message: '累计模型用量响应格式无效'
    });
  });

  it('does not read an error body or wait for its stalled cancel hook', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 503 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );
    await expect(fetchLlmUsage()).rejects.toMatchObject({ code: 'unavailable' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects a bodyless successful response rather than manufacturing an empty summary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 }))
    );
    await expect(fetchLlmUsage()).rejects.toMatchObject({ code: 'invalid' });
  });

  it('decodes UTF-8 split across stream chunks without replacing model/profile text', async () => {
    const value = fixture();
    value.profiles[0].profileId = '本机合成测试';
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const firstChineseByte = bytes.findIndex((byte) => byte >= 0x80);
    expect(firstChineseByte).toBeGreaterThan(0);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, firstChineseByte + 1));
        controller.enqueue(bytes.slice(firstChineseByte + 1));
        controller.close();
      }
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body))
    );
    await expect(fetchLlmUsage()).resolves.toEqual(value);
  });

  it('bounds a fetch that ignores abort, allowing the caller to retry', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchSpy = vi.fn((_url: string, options: RequestInit) => {
      signal = options.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchSpy);
    const pending = fetchLlmUsage();
    const observed = expect(pending).rejects.toMatchObject({
      code: 'timeout',
      message: '累计模型用量读取超时，请稍后刷新'
    });
    await vi.advanceTimersByTimeAsync(LLM_USAGE_READ_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await observed;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    fetchSpy.mockImplementationOnce(async () => new Response(JSON.stringify(fixture())));
    await expect(fetchLlmUsage()).resolves.toEqual(fixture());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps the same deadline after headers while cancelling a stalled reader', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );
    const pending = fetchLlmUsage();
    const observed = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(LLM_USAGE_READ_TIMEOUT_MS + 1);
    await observed;
    expect(cancel).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(response.body?.locked).toBe(false);
  });

  it('refuses an already cancelled caller without starting fetch or exposing its reason', async () => {
    const caller = new AbortController();
    caller.abort(new Error('private-usage-response-sentinel'));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(fetchLlmUsage({ signal: caller.signal })).rejects.toMatchObject({
      code: 'cancelled',
      message: '累计模型用量读取已取消'
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('propagates later caller cancellation, removes its listener and clears the timer', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options: RequestInit) => {
        signal = options.signal ?? undefined;
        return new Promise<Response>(() => {});
      })
    );
    const pending = fetchLlmUsage({ signal: caller.signal });
    const observed = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await vi.advanceTimersByTimeAsync(0);
    caller.abort(new Error('private-usage-response-sentinel'));
    await observed;
    expect(signal?.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discards and cancels a response arriving after the read already timed out', async () => {
    vi.useFakeTimers();
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((accept) => {
            resolve = accept;
          })
      )
    );
    const pending = fetchLlmUsage();
    const observed = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(LLM_USAGE_READ_TIMEOUT_MS + 1);
    await observed;
    const cancel = vi.fn();
    resolve(new Response(new ReadableStream<Uint8Array>({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('accepts a complete valid body exactly at the byte limit, without truncating its tokens', async () => {
    const body = JSON.stringify(fixture());
    const padded =
      body + ' '.repeat(LLM_USAGE_RESPONSE_MAX_BYTES - new TextEncoder().encode(body).byteLength);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(padded))
    );
    await expect(fetchLlmUsage()).resolves.toEqual(fixture());
  });

  it.each([null, '1', 'not-a-size'])(
    'counts actual streamed bytes even with an absent/lying header: %s',
    async (declared) => {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(LLM_USAGE_RESPONSE_MAX_BYTES));
          controller.enqueue(new Uint8Array([1]));
        },
        cancel
      });
      const response = new Response(body, {
        headers: declared === null ? {} : { 'content-length': declared }
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response)
      );
      await expect(fetchLlmUsage()).rejects.toMatchObject({ code: 'too_large' });
      expect(cancel).toHaveBeenCalledTimes(1);
    }
  );

  it.each([String(LLM_USAGE_RESPONSE_MAX_BYTES + 1), '9'.repeat(1000)])(
    'rejects an oversized declared body before reading (case %#)',
    async (declared) => {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({ cancel });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(body, { headers: { 'content-length': declared } }))
      );
      await expect(fetchLlmUsage()).rejects.toMatchObject({ code: 'too_large' });
      expect(cancel).toHaveBeenCalledTimes(1);
    }
  );

  it('sanitizes a stream read failure rather than exposing its raw error', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('private-usage-response-sentinel'));
      }
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body))
    );
    await expect(fetchLlmUsage()).rejects.toMatchObject({
      code: 'unavailable',
      message: '累计模型用量暂时无法读取'
    });
  });
});
