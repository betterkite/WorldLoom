import { afterEach, describe, expect, it, vi } from 'vitest';
import { llmUsageSummarySchema, formatLlmUsageCount } from '@/lib/llm/usage-summary';
import { fetchLlmUsage } from '@/features/worlds/api/usage';

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
    profiles: [{ profileId: 'mock', model: 'mock', ...totals }],
    recording: { currentProcessWriteFailures: '0' }
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('cumulative usage frontend boundary', () => {
  it('keeps cumulative tokens exact and displays unknown tokens separately', () => {
    expect(llmUsageSummarySchema.parse(fixture()).totals.totalTokens).toBe('9007199254740995');
    expect(formatLlmUsageCount('9007199254740993')).toBe('9,007,199,254,740,993');
    expect(formatLlmUsageCount(null)).toBe('暂无完整用量');
  });

  it.each(['1junk', '-1', '01', '1.5', '9'.repeat(81)])(
    'rejects malformed counter %s without a BigInt exception',
    (value) => {
      const input = fixture();
      input.totals.calls = value;

      expect(llmUsageSummarySchema.safeParse(input).success).toBe(false);
    }
  );

  it('rejects inconsistent known/unknown counts and profile totals', () => {
    const input = fixture();
    input.totals.unknownUsageCalls = '1';
    expect(llmUsageSummarySchema.safeParse(input).success).toBe(false);
    const other = fixture();
    other.totals.totalTokens = '0';
    expect(llmUsageSummarySchema.safeParse(other).success).toBe(false);
  });

  it.each([null, {}, { totals: null }])(
    'rejects malformed successful API payloads: %j',
    async (payload) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify(payload)))
      );

      await expect(fetchLlmUsage()).rejects.toThrow('累计模型用量响应格式无效');
    }
  );

  it('keeps API failure as a recoverable query error instead of zero usage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 }))
    );

    await expect(fetchLlmUsage()).rejects.toThrow('累计模型用量暂时无法读取');
  });
});
