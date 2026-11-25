import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  fetchFocusGraph,
  fetchGraph,
  fetchRelationsAt,
  fetchTimeline,
  fetchWorlds
} from '@/features/worlds/api/service';
import { timelineQueryOptions } from '@/features/worlds/api/queries';

afterEach(() => vi.unstubAllGlobals());

describe('world list response boundary', () => {
  it.each([null, {}, { worlds: null }, { worlds: [null] }, { worlds: [{}] }])(
    'rejects malformed successful payloads before rendering: %j',
    async (payload) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify(payload)))
      );
      await expect(fetchWorlds()).rejects.toThrow('世界列表响应格式无效');
    }
  );
  it('accepts an empty world list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ worlds: [] })))
    );
    await expect(fetchWorlds()).resolves.toEqual({ worlds: [] });
  });
  it('keeps API failures as recoverable query errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 }))
    );
    await expect(fetchWorlds()).rejects.toThrow('Request failed: 503');
  });
});

describe('versioned timeline and graph reads', () => {
  it.each([
    ['timeline', () => fetchTimeline('world', null, 2)],
    ['relations', () => fetchRelationsAt('world', 'event', 2)],
    ['graph', () => fetchGraph('world', 2)],
    ['focus', () => fetchFocusGraph('world', 'relations', { asOf: 'event', version: 2 })]
  ] as const)('rejects a mismatched successful %s response', async (_name, request) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ version: 3 }))
    );
    await expect(request()).rejects.toThrow();
  });

  it('keeps a delayed older timeline response out of the new version cache', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const version = Number(
          new URL(input, 'http://fixture.invalid').searchParams.get('version')
        );
        if (version === 2) await gate;
        return Response.json({ version, segments: [], edges: [] });
      })
    );
    const oldQuery = timelineQueryOptions('world', null, 2);
    const newQuery = timelineQueryOptions('world', null, 3);
    try {
      const oldResponse = client.fetchQuery(oldQuery);
      await expect(client.fetchQuery(newQuery)).resolves.toMatchObject({ version: 3 });
      release();
      await expect(oldResponse).resolves.toMatchObject({ version: 2 });
      expect(client.getQueryData(newQuery.queryKey)?.version).toBe(3);
      expect(client.getQueryData(oldQuery.queryKey)?.version).toBe(2);
    } finally {
      release();
      client.clear();
    }
  });
});
