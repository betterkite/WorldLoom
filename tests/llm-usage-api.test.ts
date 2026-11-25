import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/llm/usage-tracking', () => ({ readLlmUsageSummary: mocks.read }));
import { GET } from '@/app/api/llm/usage/route';
import type { LlmUsageSummary } from '@/lib/llm/usage-summary';

beforeEach(() => {
  // Vitest treats a function returned by beforeEach as an afterEach cleanup.
  // Do not return the mock itself: the failure fixture rejects if invoked again.
  mocks.read.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('read-only cumulative usage API', () => {
  it('returns local statistics with no-store and does not contact a provider', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const totals = {
      calls: '2',
      knownUsageCalls: '1',
      unknownUsageCalls: '1',
      pendingCalls: '0',
      failedCalls: '1',
      inputTokens: '10',
      outputTokens: '20',
      totalTokens: '30'
    };
    const summary: LlmUsageSummary = {
      scope: 'local-recorded-chat-attempts',
      recordedFrom: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T01:00:00.000Z',
      totals,
      profiles: [{ profileId: 'mock', model: 'mock', ...totals }],
      recording: { currentProcessWriteFailures: '0' }
    };
    mocks.read.mockResolvedValue(summary);
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(summary);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not turn a failed database/migration read into zero or expose private details', async () => {
    mocks.read.mockRejectedValue(new Error('private database credential/path sentinel'));
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(body.error.code).toBe('llm_usage_unavailable');
    expect(body).not.toHaveProperty('totals');
    expect(JSON.stringify(body)).not.toContain('private');
    expect(response.headers.get('x-correlation-id')).toBe(body.error.correlationId);
    expect(response.headers.get('retry-after')).toBeNull();
  });
});
