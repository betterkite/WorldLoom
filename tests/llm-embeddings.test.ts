import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({ get: vi.fn(), local: vi.fn(), available: vi.fn() }));
vi.mock('@/lib/llm/config', () => ({
  getEmbeddingsConfig: config.get,
  getLocalEmbeddingsConfig: config.local,
  isLocalEmbeddingAvailable: config.available,
  getCredential: vi.fn()
}));
vi.mock('@/lib/llm/local-embeddings', () => {
  class LocalEmbeddingError extends Error {
    readonly code = 'embedding_local_unavailable';
    constructor() {
      super('Local embedding model is unavailable');
      this.name = 'LocalEmbeddingError';
    }
  }
  return { embedLocally: vi.fn(), localEmbeddingSummary: vi.fn(), LocalEmbeddingError };
});

import { embed, embedWithSpace, EmbeddingError } from '@/lib/llm/embeddings';
import { localEmbeddingSpace, remoteEmbeddingSpace } from '@/lib/llm/embedding-space';
import { embedLocally, LocalEmbeddingError } from '@/lib/llm/local-embeddings';
import { EMBEDDING_RESPONSE_MAX_BYTES } from '@/lib/llm/response-body';

const dimensions = 64;
const vector = (value: number) => Array.from({ length: dimensions }, () => value);
const records = () => [
  { index: 0, embedding: vector(1) },
  { index: 1, embedding: vector(2) }
];
const local = vi.mocked(embedLocally);
const texts = ['synthetic-first', 'synthetic-second'];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('WORLDLOOM_TEST_EMBED_KEY', 'synthetic-unit-only');
  config.get.mockReset().mockReturnValue({
    enabled: true,
    baseUrl: 'https://embedding.invalid/v1',
    model: 'synthetic-remote',
    credentialEnv: 'WORLDLOOM_TEST_EMBED_KEY',
    dimensions,
    batchSize: 2
  });
  config.local
    .mockReset()
    .mockReturnValue({ enabled: true, model: 'synthetic-local', dimensions, dtype: 'int8' });
  local
    .mockReset()
    .mockImplementation(async (input) => input.map((_, index) => vector(100 + index)));
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected synthetic fetch')));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('remote embedding boundaries and whole-input local fallback, mocked providers only', () => {
  it('returns the actual remote space when the remote request succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: records() })));
    const result = await embedWithSpace(texts);
    expect(result.space).toEqual(remoteEmbeddingSpace(config.get()));
    expect(result.vectors).toEqual([vector(1), vector(2)]);
  });

  it('returns the actual local space after HTTP 402 instead of the remote model label', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 402 })));
    const result = await embedWithSpace(texts);
    expect(result.space).toEqual(localEmbeddingSpace(config.local()));
    expect(result.space.id).not.toBe(remoteEmbeddingSpace(config.get()).id);
    expect(result.vectors).toEqual([vector(100), vector(101)]);
  });

  it('replaces both identity and all vectors when a later remote batch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ data: records() }))
        .mockResolvedValueOnce(new Response(null, { status: 402 }))
    );
    const result = await embedWithSpace([...texts, 'third']);
    expect(result.space.backend).toBe('local');
    expect(result.vectors).toEqual([vector(100), vector(101), vector(102)]);
  });

  it('orders unique remote indices and preserves finite vectors without local fallback', async () => {
    const response = new Response(JSON.stringify({ data: records().toReversed() }));
    const json = vi.spyOn(response, 'json');
    const fetchSpy = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchSpy);
    await expect(embed(texts)).resolves.toEqual([vector(1), vector(2)]);
    expect(local).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect((fetchSpy.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false);
    expect(response.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('validates the shorter last batch with its own indices and keeps all remote output ordered', async () => {
    const input = [...texts, 'synthetic-third'];
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: records().toReversed() })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ index: 0, embedding: vector(3) }] }))
      );
    vi.stubGlobal('fetch', fetchSpy);
    await expect(embed(input)).resolves.toEqual([vector(1), vector(2), vector(3)]);
    expect(local).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls back on a synchronous fetch failure without retaining the private error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('private-fetch-sentinel');
      })
    );
    await expect(embed(texts)).resolves.toEqual([vector(100), vector(101)]);
    expect(local.mock.calls).toEqual([[texts]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['disabled', 'missing-key'] as const)(
    'uses local directly when remote is %s',
    async (mode) => {
      if (mode === 'disabled') config.get.mockReturnValue(null);
      else vi.stubEnv('WORLDLOOM_TEST_EMBED_KEY', '');
      await expect(embed(texts)).resolves.toEqual([vector(100), vector(101)]);
      expect(fetch).not.toHaveBeenCalled();
      expect(local.mock.calls).toEqual([[texts]]);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each([401, 402, 429, 503])(
    'does not read HTTP %s or await stalled disposal before local fallback',
    async (status) => {
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      const response = new Response(new ReadableStream<Uint8Array>({ cancel }), { status });
      const text = vi.spyOn(response, 'text');
      const json = vi.spyOn(response, 'json');
      const fetchSpy = vi.fn().mockResolvedValue(response);
      vi.stubGlobal('fetch', fetchSpy);
      await expect(embed(texts)).resolves.toEqual([vector(100), vector(101)]);
      expect(text).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(local.mock.calls).toEqual([[texts]]);
      expect((fetchSpy.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each(['reject', 'throw'] as const)(
    'keeps a %s-ing error disposal private and preserves local fallback',
    async (mode) => {
      const response = new Response(new ReadableStream(), { status: 402 });
      vi.spyOn(response.body!, 'cancel').mockImplementation(() => {
        const error = new Error('private-cleanup-sentinel');
        if (mode === 'throw') throw error;
        return Promise.reject(error);
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
      await expect(embed(texts)).resolves.toEqual([vector(100), vector(101)]);
      expect(local.mock.calls).toEqual([[texts]]);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each([
    () => null,
    () => [],
    () => ({ data: {} }),
    () => ({ data: [null, records()[1]] }),
    () => ({ data: [records()[0]] }),
    () => ({ data: [{ ...records()[0], index: '0' }, records()[1]] }),
    () => ({ data: [{ ...records()[0], index: -1 }, records()[1]] }),
    () => ({ data: [{ ...records()[0], index: 0.5 }, records()[1]] }),
    () => ({ data: [{ ...records()[0], index: 2 }, records()[1]] }),
    () => ({ data: [records()[0], { ...records()[1], index: 0 }] }),
    () => ({ data: [{ ...records()[0], embedding: ['private-vector-sentinel'] }, records()[1]] }),
    () => ({ data: [{ ...records()[0], embedding: vector(1).slice(1) }, records()[1]] }),
    () => ({
      data: [
        { ...records()[0], embedding: vector(1).map((_, index) => (index ? 1 : null)) },
        records()[1]
      ]
    }),
    () => ({
      data: [
        { ...records()[0], embedding: vector(1).map((_, index) => (index ? 1 : '1')) },
        records()[1]
      ]
    })
  ])(
    'treats malformed shape/index/dimension/value as typed failure and falls back: %#',
    async (payload) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify(payload())))
      );
      await expect(embed(texts)).resolves.toEqual([vector(100), vector(101)]);
      expect(local.mock.calls).toEqual([[texts]]);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each([
    new Uint8Array([0xc3, 0x28]),
    new TextEncoder().encode('<private-body-sentinel>'),
    new Uint8Array()
  ])('falls back on invalid UTF-8/JSON instead of exposing provider details: %#', async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body))
    );
    await expect(embed(texts)).resolves.toEqual([vector(100), vector(101)]);
    expect(local.mock.calls).toEqual([[texts]]);
  });

  it('rejects nonfinite JSON numbers without coercing them into vectors', async () => {
    const body = JSON.stringify({ data: records() }).replace(
      '"embedding":[1,',
      '"embedding":[1e400,'
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body))
    );
    await expect(embed(texts)).resolves.toEqual([vector(100), vector(101)]);
    expect(local.mock.calls).toEqual([[texts]]);
  });

  it.each(['declared', 'actual'] as const)(
    'falls back on %s byte overflow without partial vector use',
    async (mode) => {
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            if (mode === 'actual') stream.enqueue(new Uint8Array(EMBEDDING_RESPONSE_MAX_BYTES + 1));
          },
          cancel
        }),
        {
          headers: {
            'content-length': mode === 'declared' ? String(EMBEDDING_RESPONSE_MAX_BYTES + 1) : '1'
          }
        }
      );
      const json = vi.spyOn(response, 'json');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
      await expect(embed(texts)).resolves.toEqual([vector(100), vector(101)]);
      expect(json).not.toHaveBeenCalled();
      expect(local.mock.calls).toEqual([[texts]]);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('reaches local fallback at the existing body deadline even if stream/cancel ignores abort', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }));
    const fetchSpy = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchSpy);
    const observed = expect(embed(texts)).resolves.toEqual([vector(100), vector(101)]);
    await vi.advanceTimersByTimeAsync(30_001);
    await observed;
    expect((fetchSpy.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(local.mock.calls).toEqual([[texts]]);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discards earlier valid remote batches and embeds the original whole input locally on later failure', async () => {
    const input = [...texts, 'synthetic-third'];
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: records() })))
      .mockResolvedValueOnce(new Response('private-http-body', { status: 402 }));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(embed(input)).resolves.toEqual([vector(100), vector(101), vector(102)]);
    expect(local.mock.calls).toEqual([[input]]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['http', 'network', 'shape'] as const)(
    'exposes only typed unavailable error if local also fails after %s',
    async (mode) => {
      const fetchSpy =
        mode === 'network'
          ? vi.fn().mockRejectedValue(new Error('private-network-sentinel'))
          : vi
              .fn()
              .mockResolvedValue(
                mode === 'http'
                  ? new Response('private-http-body', { status: 402 })
                  : new Response(JSON.stringify({ data: 'private-shape-sentinel' }))
              );
      vi.stubGlobal('fetch', fetchSpy);
      local.mockRejectedValue(new LocalEmbeddingError());
      const error = await embed(texts).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(EmbeddingError);
      expect(error).toMatchObject({ code: 'embedding_local_unavailable' });
      expect((error as EmbeddingError).status).toBe(mode === 'http' ? 402 : undefined);
      expect(String(error)).not.toContain('private');
      expect(error).not.toHaveProperty('cause');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    }
  );
});
