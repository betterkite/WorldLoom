import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: { $queryRaw: vi.fn() }
}));

import { GET as getLive } from '@/app/api/health/live/route';
import { GET as getReady } from '@/app/api/health/ready/route';
import { prisma } from '@/lib/db/client';

const queryRaw = vi.mocked(prisma.$queryRaw);

describe('health probes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('serves a local liveness response without network or database checks', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = getLive();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toMatchObject({ status: 'ok', service: 'worldloom' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('reports ready only when the database probe succeeds', async () => {
    queryRaw.mockResolvedValue([] as never);

    const response = await getReady();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toMatchObject({ status: 'ready', checks: { database: 'ok' } });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns a sanitized 503 when the database is unavailable', async () => {
    queryRaw.mockRejectedValue(new Error('database password should not leak'));

    const response = await getReady();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: 'not_ready', checks: { database: 'unavailable' } });
    expect(JSON.stringify(body)).not.toContain('database password');
    expect(body).not.toHaveProperty('error');
  });
});
