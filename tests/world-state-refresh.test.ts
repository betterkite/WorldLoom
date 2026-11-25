import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MutationObserver,
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  type FetchQueryOptions,
  type QueryKey
} from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  detailedChangesQueryOptions,
  worldKeys,
  worldQueryOptions
} from '@/features/worlds/api/queries';
import {
  deleteChangeMutation,
  mergeWorldMutation,
  rollbackVersionMutation
} from '@/features/worlds/api/mutations';
import { WorldStatusHeader } from '@/components/layout/world-status-header';

const shared = vi.hoisted(() => ({ client: undefined as QueryClient | undefined }));
vi.mock('@/lib/query-client', () => ({ getQueryClient: () => shared.client! }));

const worldId = 'fixture-world';
let version: number;
let pending: number;
let merged: number;
let failMerge: boolean;
let client: QueryClient;
let stopObservers: (() => void)[];

function world() {
  return {
    id: worldId,
    name: '合成世界',
    premise: '',
    style: '',
    masterVersion: version,
    ingestMode: 'review' as const,
    createdAt: '',
    updatedAt: '',
    pendingChanges: pending,
    entityCount: merged,
    eventCount: 0,
    versionCount: version,
    master: { entities: merged, events: 0, epochs: 0 }
  };
}

function header() {
  return renderToStaticMarkup(
    createElement(QueryClientProvider, {
      client,
      children: createElement(WorldStatusHeader, {
        initialWorld: { id: worldId, name: '合成世界', masterVersion: 1, pendingChanges: 1 }
      })
    })
  );
}

async function watch<T, TKey extends QueryKey>(options: FetchQueryOptions<T, Error, T, TKey>) {
  await client.fetchQuery(options);
  const observer = new QueryObserver<T, Error, T, T, TKey>(client, options);
  stopObservers.push(observer.subscribe(() => undefined));
}

beforeEach(() => {
  version = 1;
  pending = 1;
  merged = 0;
  failMerge = false;
  stopObservers = [];
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 }, mutations: { retry: false } }
  });
  shared.client = client;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://fixture.invalid');
      if (init?.method === 'POST' && url.pathname.endsWith('/merge')) {
        if (failMerge) return Response.json({ error: { message: '合并失败' } }, { status: 503 });
        version += 1;
        merged += pending;
        pending = 0;
        return Response.json({ version, changeCount: merged, conflictCount: 0 });
      }
      if (init?.method === 'POST' && url.pathname.endsWith('/versions/1/rollback')) {
        version += 1;
        return Response.json({ version });
      }
      if (init?.method === 'DELETE' && url.pathname.endsWith('/changes/change-1')) {
        pending = 0;
        return Response.json({ deleted: true });
      }
      if (url.pathname.endsWith('/changes')) {
        const count = url.searchParams.get('status') === 'merged' ? merged : pending;
        return Response.json({
          changes: Array.from({ length: count }, () => ({ id: 'change-1' }))
        });
      }
      if (url.pathname === `/api/worlds/${worldId}`) return Response.json({ world: world() });
      if (url.pathname === '/api/worlds') return Response.json({ worlds: [world()] });
      throw new Error(`Unexpected fixture request: ${input}`);
    })
  );
});

afterEach(() => {
  for (const stop of stopObservers) stop();
  client.clear();
  vi.unstubAllGlobals();
});

describe('world mutations refresh actual subscribed data', () => {
  it('merge refetches pending/history and the header, and invalidates only this world’s views', async () => {
    const detail = worldQueryOptions(worldId);
    const pendingQuery = detailedChangesQueryOptions(worldId, 'pending');
    const historyQuery = detailedChangesQueryOptions(worldId, 'merged');
    await watch(detail);
    await watch(pendingQuery);
    await watch(historyQuery);
    const views = ['timeline', 'graph', 'relations', 'lint', 'versions'];
    for (const view of views) client.setQueryData([...worldKeys.scope(worldId), view], 'old');
    const other = [...worldKeys.scope('another-world'), 'graph'];
    client.setQueryData(other, 'untouched');
    expect(header()).toContain('1 待审');

    await new MutationObserver(client, mergeWorldMutation(worldId)).mutate('manual merge');

    expect(client.getQueryData(pendingQuery.queryKey)?.changes).toHaveLength(0);
    expect(client.getQueryData(historyQuery.queryKey)?.changes).toHaveLength(1);
    expect(header()).toContain('v2');
    expect(header()).not.toContain('待审');
    for (const view of views) {
      expect(client.getQueryState([...worldKeys.scope(worldId), view])?.isInvalidated).toBe(true);
    }
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  });

  it('discard refetches the detailed queue and pending count without creating a version', async () => {
    const queue = detailedChangesQueryOptions(worldId, 'pending');
    await watch(queue);
    await watch(worldQueryOptions(worldId));
    await new MutationObserver(client, deleteChangeMutation(worldId)).mutate('change-1');
    expect(client.getQueryData(queue.queryKey)?.changes).toHaveLength(0);
    expect(header()).toContain('v1');
    expect(header()).not.toContain('待审');
  });

  it('rollback refetches the header from the appended backend version', async () => {
    version = 2;
    pending = 0;
    await watch(worldQueryOptions(worldId));
    await new MutationObserver(client, rollbackVersionMutation(worldId)).mutate(1);
    expect(header()).toContain('v3');
    expect(header()).not.toContain('待审');
  });

  it('a failed merge preserves real pending data rather than faking a completed review', async () => {
    failMerge = true;
    const queue = detailedChangesQueryOptions(worldId, 'pending');
    await watch(queue);
    await watch(worldQueryOptions(worldId));
    await expect(
      new MutationObserver(client, mergeWorldMutation(worldId)).mutate('fail')
    ).rejects.toThrow('合并失败');
    expect(client.getQueryData(queue.queryKey)?.changes).toHaveLength(1);
    expect(header()).toContain('v1');
    expect(header()).toContain('1 待审');
  });

  it('marks a failed header refresh as stale and exposes retry', () => {
    client.setQueryData(worldKeys.detail(worldId), { world: world() });
    client
      .getQueryCache()
      .find({ queryKey: worldKeys.detail(worldId) })!
      .setState({
        status: 'error',
        error: new Error('offline')
      });
    expect(header()).toContain('role="alert"');
    expect(header()).toContain('当前显示上次状态');
    expect(header()).toContain('重试');
  });
});
