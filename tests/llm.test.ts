import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tracking = vi.hoisted(() => ({ begin: vi.fn(), finish: vi.fn() }));
vi.mock('@/lib/llm/usage-tracking', () => ({
  beginLlmUsageAttempt: tracking.begin,
  finishLlmUsageAttempt: tracking.finish
}));
import {
  getProfile,
  getDefaultProfileId,
  getEmbeddingsConfig,
  getProfileLimits,
  listProfileIds,
  isCredentialConfigured,
  LlmConfigError
} from '@/lib/llm/config';
import { chat, detect, resetDetectCache, LlmError } from '@/lib/llm/client';
import { embed, embeddingConfigSummary } from '@/lib/llm/embeddings';
import { CHAT_RESPONSE_MAX_BYTES } from '@/lib/llm/response-body';

const originalEnv = { ...process.env };

describe('llm config (locked profiles)', () => {
  it('parses config/llm.json and exposes profiles', () => {
    expect(getDefaultProfileId()).toBe('deepseek-official');
    expect(listProfileIds()).toContain('modelport');
    const profile = getProfile('deepseek-official');
    expect(profile.model).toBe('deepseek-flash');
    expect(profile.baseUrl).toBe('https://api.deepseek.com');
    expect(profile.credentialEnv).toBe('DEEPSEEK_API_KEY');
  });

  it('falls back to the default profile', () => {
    expect(getProfile(null).id).toBe('deepseek-official');
    expect(getProfile('').id).toBe('deepseek-official');
  });

  it('rejects unknown profile ids', () => {
    expect(() => getProfile('nope')).toThrow(LlmConfigError);
    try {
      getProfile('nope');
    } catch (error) {
      expect((error as LlmConfigError).code).toBe('llm_profile_unknown');
    }
  });

  it('reports credential presence without leaking values', () => {
    process.env.DEEPSEEK_API_KEY = 'secret-key';
    expect(isCredentialConfigured(getProfile('deepseek-official'))).toBe(true);
    delete process.env.DEEPSEEK_API_KEY;
    expect(isCredentialConfigured(getProfile('deepseek-official'))).toBe(false);
  });

  it('applies approved runtime budget overrides and fails closed on invalid values', () => {
    const names = [
      'WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN',
      'WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN',
      'WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN'
    ] as const;
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      process.env.WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN = '120000';
      process.env.WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN = '24000';
      process.env.WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN = '1.5';
      expect(getProfileLimits('deepseek-official')).toEqual({
        maxInputTokensPerRun: 120000,
        maxOutputTokensPerRun: 24000,
        maxEstimatedCostUsdPerRun: 1.5
      });

      process.env.WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN = 'not-a-number';
      expect(() => getProfileLimits('deepseek-official')).toThrow(LlmConfigError);
      expect(getProfileLimits('modelport')).toBeNull();
    } finally {
      for (const name of names) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
    }
  });
});

describe('llm client', () => {
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    resetDetectCache();
    vi.restoreAllMocks();
    tracking.begin
      .mockReset()
      .mockImplementation(async (profile: { id: string; model: string }) => ({
        id: `mock-attempt-${tracking.begin.mock.calls.length}`,
        profileId: profile.id,
        model: profile.model,
        startedAt: new Date()
      }));
    tracking.finish.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('throws llm_credential_missing when env is unset (no fetch attempted)', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      chat({ profileId: 'deepseek-official', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toMatchObject({ code: 'llm_credential_missing' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(tracking.begin).not.toHaveBeenCalled();
    expect(tracking.finish).not.toHaveBeenCalled();
  });

  it('returns content on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'hello world' } }] }), {
          status: 200
        })
      )
    );
    const result = await chat({
      profileId: 'deepseek-official',
      messages: [{ role: 'user', content: 'hi' }]
    });
    expect(result.content).toBe('hello world');
    expect(result.profileId).toBe('deepseek-official');
    expect(result.usage).toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(tracking.begin).toHaveBeenCalledOnce();
    expect(tracking.finish).toHaveBeenCalledWith(expect.any(Object), null, true);
  });

  it('normalizes provider usage for budget accounting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'hello world' } }],
            usage: { prompt_tokens: 123, completion_tokens: 45 }
          }),
          { status: 200 }
        )
      )
    );
    await expect(
      chat({ profileId: 'deepseek-official', messages: [{ role: 'user', content: 'hi' }] })
    ).resolves.toMatchObject({ usage: { inputTokens: 123, outputTokens: 45 } });
    expect(tracking.finish).toHaveBeenCalledWith(
      expect.any(Object),
      { inputTokens: 123, outputTokens: 45 },
      true
    );
  });

  it('rejects declared oversized success without parsing/counting its usage or retrying', async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream({ cancel: cancelled }), {
      headers: { 'content-length': String(CHAT_RESPONSE_MAX_BYTES + 1) }
    });
    const json = vi.spyOn(response, 'json');
    const fetchSpy = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchSpy);
    const observed = expect(
      chat({ messages: [{ role: 'user', content: 'synthetic' }] })
    ).rejects.toMatchObject({ code: 'llm_response_too_large' });
    await vi.advanceTimersByTimeAsync(0);
    await observed;
    expect(json).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(tracking.finish).toHaveBeenCalledWith(expect.any(Object), null, false);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not truncate a valid oversized JSON reply into a completion or known usage', async () => {
    const small = JSON.stringify({
      choices: [{ message: { content: 'synthetic' } }],
      usage: { prompt_tokens: 3, completion_tokens: 4 }
    });
    const body = `${small}${' '.repeat(CHAT_RESPONSE_MAX_BYTES - small.length + 1)}`;
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(body, { headers: { 'content-length': '1' } }));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      chat({ messages: [{ role: 'user', content: 'synthetic' }] })
    ).rejects.toMatchObject({ code: 'llm_response_too_large' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(tracking.finish).toHaveBeenCalledWith(expect.any(Object), null, false);
  });

  it('ends body reading on its existing deadline even if the stream/cancel ignores transport abort', async () => {
    vi.useFakeTimers();
    process.env.MODELPORT_API_KEY = 'synthetic-only';
    const cancelled = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream({ cancel: cancelled }));
    const fetchSpy = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchSpy);
    const observed = expect(
      chat({ profileId: 'modelport', messages: [{ role: 'user', content: 'synthetic' }] })
    ).rejects.toMatchObject({ code: 'llm_timeout' });
    await vi.advanceTimersByTimeAsync(60_001);
    await observed;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(response.body?.locked).toBe(false);
    expect(tracking.finish).toHaveBeenCalledWith(expect.any(Object), null, false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts input/output usage aliases and rejects partial usage', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'first' } }],
            usage: { input_tokens: 7, output_tokens: 8 }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'second' } }],
            usage: { prompt_tokens: 7 }
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      chat({ profileId: 'deepseek-official', messages: [{ role: 'user', content: 'hi' }] })
    ).resolves.toMatchObject({ usage: { inputTokens: 7, outputTokens: 8 } });
    await expect(
      chat({ profileId: 'deepseek-official', messages: [{ role: 'user', content: 'hi' }] })
    ).resolves.toMatchObject({ usage: null });
  });

  it('retries an empty completion once, then throws llm_empty_completion', async () => {
    const fetchSpy = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 })
        )
      );
    vi.stubGlobal('fetch', fetchSpy);
    // deepseek-official has maxRetries: 1
    await expect(
      chat({ profileId: 'deepseek-official', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toMatchObject({ code: 'llm_empty_completion' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(tracking.begin).toHaveBeenCalledTimes(2);
    expect(tracking.finish).toHaveBeenCalledTimes(2);
    expect(tracking.finish.mock.calls.map(([attempt]) => attempt.id)).toEqual([
      'mock-attempt-1',
      'mock-attempt-2'
    ]);
    expect(tracking.finish.mock.calls.every(([, , completed]) => completed === false)).toBe(true);
  }, 10_000);

  it('records the valid usage of each failed empty completion, including its retry', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '' } }],
              usage: { prompt_tokens: 5, completion_tokens: 7 }
            })
          )
      )
    );
    const rejected = expect(
      chat({ messages: [{ role: 'user', content: 'synthetic' }] })
    ).rejects.toMatchObject({ code: 'llm_empty_completion' });
    await vi.advanceTimersByTimeAsync(801);
    await rejected;

    expect(tracking.finish).toHaveBeenCalledTimes(2);
    expect(tracking.finish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'mock-attempt-1' }),
      { inputTokens: 5, outputTokens: 7 },
      false
    );
    expect(tracking.finish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'mock-attempt-2' }),
      { inputTokens: 5, outputTokens: 7 },
      false
    );
  });

  it('does not retry non-retryable upstream errors (4xx)', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('provider account secret', { status: 401 }));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      chat({ profileId: 'deepseek-official', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toMatchObject({
      code: 'llm_upstream_error',
      status: 401,
      message: 'Profile "deepseek-official" returned HTTP 401'
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(tracking.finish).toHaveBeenCalledWith(expect.any(Object), null, false);
  });

  it('keeps the timeout active when headers arrive but the success body stalls', async () => {
    vi.useFakeTimers();
    process.env.MODELPORT_API_KEY = 'test-only';
    const fetchSpy = vi.fn(async (_url, init: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          init.signal?.addEventListener('abort', () =>
            controller.error(new DOMException('private provider timeout detail', 'AbortError'))
          );
        }
      });
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const rejected = expect(
      chat({ profileId: 'modelport', messages: [{ role: 'user', content: 'synthetic' }] })
    ).rejects.toMatchObject({
      code: 'llm_timeout',
      message: 'Profile "modelport" timed out after 60000ms'
    });
    await vi.advanceTimersByTimeAsync(60_001);
    await rejected;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('cancels an error body without waiting for it to finish or exposing it', async () => {
    const cancelled = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('private provider secret'));
              },
              cancel: cancelled
            }),
            { status: 401 }
          )
      )
    );
    await expect(
      chat({ messages: [{ role: 'user', content: 'synthetic' }] })
    ).rejects.toMatchObject({
      code: 'llm_upstream_error',
      status: 401,
      message: 'Profile "deepseek-official" returned HTTP 401'
    });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it.each([401, 402])(
    'does not wait for stalled disposal before reporting HTTP %s',
    async (status) => {
      vi.useFakeTimers();
      const cancelled = vi.fn(() => new Promise<void>(() => {}));
      const response = new Response(new ReadableStream({ cancel: cancelled }), { status });
      const read = vi.spyOn(response, 'json');
      const fetchSpy = vi.fn().mockResolvedValue(response);
      vi.stubGlobal('fetch', fetchSpy);
      const pending = chat({ messages: [{ role: 'user', content: 'synthetic' }] });
      const rejected = expect(pending).rejects.toMatchObject({
        code: 'llm_upstream_error',
        status,
        message: `Profile "deepseek-official" returned HTTP ${status}`
      });
      await vi.advanceTimersByTimeAsync(0);
      await rejected;
      expect(cancelled).toHaveBeenCalledTimes(1);
      expect(read).not.toHaveBeenCalled();
      expect((fetchSpy.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(tracking.finish).toHaveBeenCalledWith(expect.any(Object), null, false);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each(['reject', 'throw'] as const)(
    'keeps a %s-ing cleanup failure private and preserves provider status',
    async (mode) => {
      vi.useFakeTimers();
      const response = new Response(new ReadableStream(), { status: 402 });
      const cancelled = vi.spyOn(response.body!, 'cancel').mockImplementation(() => {
        const privateError = new Error('private-cleanup-response-sentinel');
        if (mode === 'throw') throw privateError;
        return Promise.reject(privateError);
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
      const pending = chat({ messages: [{ role: 'user', content: 'synthetic' }] }).catch(
        (error) => error
      );
      await vi.advanceTimersByTimeAsync(0);
      const error = await pending;
      expect(error).toBeInstanceOf(LlmError);
      expect(error).toMatchObject({ code: 'llm_upstream_error', status: 402 });
      expect(String(error)).not.toContain('private-cleanup-response-sentinel');
      expect(error).not.toHaveProperty('cause');
      expect(cancelled).toHaveBeenCalledTimes(1);
      expect(tracking.finish).toHaveBeenCalledWith(expect.any(Object), null, false);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each([429, 503])(
    'keeps the existing bounded retry and per-attempt usage after stalled HTTP %s cleanup',
    async (status) => {
      vi.useFakeTimers();
      const cancelled = vi.fn(() => new Promise<void>(() => {}));
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelled }), { status }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'synthetic success' } }],
              usage: { prompt_tokens: 3, completion_tokens: 4 }
            })
          )
        );
      vi.stubGlobal('fetch', fetchSpy);
      const pending = chat({ messages: [{ role: 'user', content: 'synthetic' }] });
      const observed = expect(pending).resolves.toMatchObject({
        content: 'synthetic success',
        usage: { inputTokens: 3, outputTokens: 4 }
      });
      await vi.advanceTimersByTimeAsync(801);
      await observed;
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(cancelled).toHaveBeenCalledTimes(1);
      expect((fetchSpy.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
      expect(tracking.finish).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ id: 'mock-attempt-1' }),
        null,
        false
      );
      expect(tracking.finish).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ id: 'mock-attempt-2' }),
        { inputTokens: 3, outputTokens: 4 },
        true
      );
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('rejects non-string content as a sanitized provider format error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { content: { private: 'secret' } } }] })
          )
      )
    );
    await expect(
      chat({ messages: [{ role: 'user', content: 'synthetic' }] })
    ).rejects.toMatchObject({
      code: 'llm_invalid_response',
      message: 'Profile "deepseek-official" returned invalid content'
    });
  });

  it('does not expose network error details in completion or health probe errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private endpoint secret')));
    await expect(
      chat({ profileId: 'deepseek-official', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toMatchObject({
      code: 'llm_upstream_error',
      message: 'Profile "deepseek-official" request failed'
    });

    resetDetectCache();
    const result = await detect('deepseek-official');
    expect(result.error).toBe('probe failed');
    expect(result.error).not.toContain('private endpoint secret');
  });

  it('falls back to local embeddings when the remote endpoint fails', async () => {
    const config = getEmbeddingsConfig();
    if (!config) return;
    const previous = process.env[config.credentialEnv];
    process.env[config.credentialEnv] = 'test-only-not-a-secret';
    const fetchSpy = vi.fn().mockRejectedValue(new Error('provider network secret'));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const vectors = await embed(['worldloom'], { localEmbedFn: async () => [[1, 0]] });
      expect(vectors).toEqual([[1, 0]]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) delete process.env[config.credentialEnv];
      else process.env[config.credentialEnv] = previous;
    }
  });

  it('summarizes embedding readiness without provider balance fields', () => {
    const summary = embeddingConfigSummary();
    expect(summary).toMatchObject({
      enabled: true,
      model: 'BAAI/bge-m3',
      dimensions: 1024,
      local: { enabled: true, model: 'Xenova/bge-m3', dimensions: 1024 }
    });
    expect(summary).not.toHaveProperty('balance');
    expect(JSON.stringify(summary)).not.toContain('balance');
  });

  it('detect reports ok and caches the result', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const first = await detect('deepseek-official');
    expect(first.detected).toBe(true);
    expect(first.configured).toBe(true);
    await detect('deepseek-official');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // cached
  });

  it.each([200, 402])(
    'disposes header-only HTTP %s probe bodies without waiting or recording chat usage',
    async (status) => {
      vi.useFakeTimers();
      const cancelled = vi.fn(() => new Promise<void>(() => {}));
      const response = new Response(new ReadableStream({ cancel: cancelled }), { status });
      const read = vi.spyOn(response, 'json');
      const fetchSpy = vi.fn().mockResolvedValue(response);
      vi.stubGlobal('fetch', fetchSpy);
      const pending = detect('deepseek-official');
      await vi.advanceTimersByTimeAsync(0);
      const result = await pending;
      expect(result).toMatchObject({
        configured: true,
        detected: status === 200,
        error: status === 200 ? null : 'GET /models returned 402'
      });
      expect((fetchSpy.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
      expect(cancelled).toHaveBeenCalledTimes(1);
      expect(read).not.toHaveBeenCalled();
      expect(tracking.begin).not.toHaveBeenCalled();
      expect(tracking.finish).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(await detect('deepseek-official')).toEqual(result);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['reject', 'throw'] as const)(
    'does not turn %s-ing unused probe cleanup into a probe failure',
    async (mode) => {
      vi.useFakeTimers();
      const response = new Response(new ReadableStream(), { status: 200 });
      vi.spyOn(response.body!, 'cancel').mockImplementation(() => {
        const privateError = new Error('private-probe-cleanup-sentinel');
        if (mode === 'throw') throw privateError;
        return Promise.reject(privateError);
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
      const pending = detect('deepseek-official');
      await vi.advanceTimersByTimeAsync(0);
      const result = await pending;
      expect(result.detected).toBe(true);
      expect(result.error).toBeNull();
      expect(JSON.stringify(result)).not.toContain('private-probe-cleanup-sentinel');
      expect(tracking.begin).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('detect reports missing credential without network', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await detect('deepseek-official');
    expect(result.detected).toBe(false);
    expect(result.error).toContain('DEEPSEEK_API_KEY');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('llm error type', () => {
  it('carries code, profileId and optional status', () => {
    const error = new LlmError('llm_upstream_error', 'p1', 'boom', { status: 502 });
    expect(error.code).toBe('llm_upstream_error');
    expect(error.profileId).toBe('p1');
    expect(error.status).toBe(502);
    expect(error.name).toBe('LlmError');
  });
});
