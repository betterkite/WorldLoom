import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProfile,
  getDefaultProfileId,
  getEmbeddingsConfig,
  listProfileIds,
  isCredentialConfigured,
  LlmConfigError
} from '@/lib/llm/config';
import { chat, detect, resetDetectCache, LlmError } from '@/lib/llm/client';
import { embed, embeddingConfigSummary } from '@/lib/llm/embeddings';

const originalEnv = { ...process.env };

describe('llm config (locked profiles)', () => {
  it('parses config/llm.json and exposes profiles', () => {
    expect(getDefaultProfileId()).toBe('deepseek-official');
    expect(listProfileIds()).toContain('modelport');
    const profile = getProfile('deepseek-official');
    expect(profile.model).toBe('deepseek-chat');
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
});

describe('llm client', () => {
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    resetDetectCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('throws llm_credential_missing when env is unset (no fetch attempted)', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      chat({ profileId: 'deepseek-official', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toMatchObject({ code: 'llm_credential_missing' });
    expect(fetchSpy).not.toHaveBeenCalled();
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
  }, 10_000);

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
