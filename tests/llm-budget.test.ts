import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProfile } from '@/lib/llm/config';
import { chat } from '@/lib/llm/client';
import { reserveLlmCall } from '@/lib/llm/budget';
import { getCompileChunkLimit, splitForCompile } from '@/lib/worldbuilding/genesis';
import { errorResponse } from '@/lib/api';

const tracking = vi.hoisted(() => ({ begin: vi.fn(), finish: vi.fn() }));
vi.mock('@/lib/llm/usage-tracking', () => ({
  beginLlmUsageAttempt: tracking.begin,
  finishLlmUsageAttempt: tracking.finish
}));

let directory: string;
let ledger: string;
const request = {
  messages: [{ role: 'user' as const, content: 'private test content' }],
  maxTokens: 8_000
};
const profile = getProfile('deepseek-official');
const env = () => ({ WORLDLOOM_LLM_BUDGET_CNY: '5', WORLDLOOM_LLM_BUDGET_LEDGER: ledger });
const read = () => JSON.parse(readFileSync(ledger, 'utf8'));

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'worldloom-budget-test-'));
  ledger = join(directory, 'ledger.json');
  tracking.begin.mockReset().mockImplementation(async (profile: { id: string; model: string }) => ({
    id: 'budget-unit-attempt',
    profileId: profile.id,
    model: profile.model,
    startedAt: new Date()
  }));
  tracking.finish.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

describe('aggregate CNY ledger', () => {
  it('keeps the default thinking behavior unchanged without exposing credentials', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-only');
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 }
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetch);
    await chat(request);
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.thinking).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('test-only');
  });
  it('reserves before calls, settles at declared peak rates, and survives new instances', () => {
    const call = reserveLlmCall(profile, request, env())!;
    expect(read().entries[0].state).toBe('reserved');
    call.settle({ inputTokens: 100, outputTokens: 200 });
    expect(read().entries[0]).toMatchObject({ state: 'settled', heldMicroCny: 1_800 });
    reserveLlmCall(profile, request, env())!.settle({ inputTokens: 100, outputTokens: 200 });
    expect(
      read().entries.reduce(
        (sum: number, entry: { heldMicroCny: number }) => sum + entry.heldMicroCny,
        0
      )
    ).toBe(3_600);
    expect(readFileSync(ledger, 'utf8')).not.toContain('private test content');
  });

  it('accounts for all in-flight reservations and denies a burst beyond five yuan', () => {
    let allowed = 0;
    for (let index = 0; index < 100; index += 1) {
      try {
        reserveLlmCall(profile, request, env());
        allowed += 1;
      } catch {
        break;
      }
    }
    expect(allowed).toBeGreaterThan(1);
    expect(allowed).toBeLessThan(100);
    expect(
      read().entries.reduce(
        (sum: number, entry: { heldMicroCny: number }) => sum + entry.heldMicroCny,
        0
      )
    ).toBeLessThanOrEqual(5_000_000);
    expect(() => reserveLlmCall(profile, request, env())).toThrow('已停止新的付费请求');
  });

  it.each([
    null,
    { inputTokens: 999_999, outputTokens: 0 },
    { inputTokens: 1, outputTokens: 8_001 }
  ])('unknown or out-of-reservation usage freezes new paid requests (%j)', (usage) => {
    reserveLlmCall(profile, request, env())!.settle(usage);
    expect(read().entries[0].state).toBe('unknown');
    expect(read().entries[0].heldMicroCny).toBeGreaterThan(0);
    expect(() => reserveLlmCall(profile, request, env())).toThrow();
  });

  it('preserves uncertain timeout charges, malformed ledgers and stale locks fail closed', () => {
    reserveLlmCall(profile, request, env())!.unknown();
    expect(() => reserveLlmCall(profile, request, env())).toThrow();
    writeFileSync(ledger, 'malformed');
    expect(() => reserveLlmCall(profile, request, env())).toThrow();
    expect(readFileSync(ledger, 'utf8')).toBe('malformed');
    writeFileSync(`${ledger}.lock`, 'existing lock');
    expect(() => reserveLlmCall(profile, request, env())).toThrow();
    expect(readFileSync(`${ledger}.lock`, 'utf8')).toBe('existing lock');
  });

  it('rejects missing/invalid configuration, changed caps and profiles without CNY prices', () => {
    expect(reserveLlmCall(profile, request, {})).toBeNull();
    for (const raw of ['0', '-1', 'NaN', 'Infinity', ''])
      expect(() =>
        reserveLlmCall(profile, request, { ...env(), WORLDLOOM_LLM_BUDGET_CNY: raw })
      ).toThrow();
    expect(() => reserveLlmCall(profile, request, { WORLDLOOM_LLM_BUDGET_CNY: '5' })).toThrow();
    expect(() => reserveLlmCall(profile, { ...request, maxTokens: undefined }, env())).toThrow();
    expect(() => reserveLlmCall(getProfile('modelport'), request, env())).toThrow();
    reserveLlmCall(profile, request, env());
    expect(() =>
      reserveLlmCall(profile, request, { ...env(), WORLDLOOM_LLM_BUDGET_CNY: '6' })
    ).toThrow();
  });

  it('does not call fetch when aggregate budget is insufficient', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-only');
    vi.stubEnv('WORLDLOOM_LLM_BUDGET_CNY', '0.01');
    vi.stubEnv('WORLDLOOM_LLM_BUDGET_LEDGER', ledger);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(chat(request)).rejects.toMatchObject({ code: 'llm_budget_exceeded' });
    expect(fetch).not.toHaveBeenCalled();
    const error = await chat(request).catch((failure: unknown) => failure);
    const response = errorResponse(error);
    const body = await response.json();
    expect(response.status).toBe(429);
    expect(body.error.code).toBe('llm_budget_exceeded');
    expect(response.headers.get('retry-after')).toBeNull();
    expect(JSON.stringify(body)).not.toContain('test-only');
    expect(JSON.stringify(body)).not.toContain(ledger);
    expect(fetch).not.toHaveBeenCalled();
    expect(tracking.begin).not.toHaveBeenCalled();
    expect(tracking.finish).not.toHaveBeenCalled();
  });

  it('does not retry a timeout with unknown charges', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-only');
    vi.stubEnv('WORLDLOOM_LLM_BUDGET_CNY', '5');
    vi.stubEnv('WORLDLOOM_LLM_BUDGET_LEDGER', ledger);
    const fetch = vi.fn().mockRejectedValue(new Error('private upstream details'));
    vi.stubGlobal('fetch', fetch);
    await expect(chat(request)).rejects.toMatchObject({ code: 'llm_upstream_error' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(read().entries[0].state).toBe('unknown');
    await expect(chat(request)).rejects.toMatchObject({ code: 'llm_budget_exceeded' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(readFileSync(ledger, 'utf8')).not.toContain('private upstream details');
  });
});

describe('opt-in long-document compiler boundaries', () => {
  it('keeps conservative defaults and validates measured-test overrides', () => {
    expect(getCompileChunkLimit({})).toBe(1_000);
    expect(getCompileChunkLimit({ WORLDLOOM_COMPILE_CHUNK_SIZE: '8000' })).toBe(8_000);
    for (const value of ['999', '8001', '4junk', '', '-1'])
      expect(() => getCompileChunkLimit({ WORLDLOOM_COMPILE_CHUNK_SIZE: value })).toThrow();
    const content = `${'完整素材。'.repeat(5_000)}尾部`;
    const chunks = splitForCompile(content, 8_000);
    expect(chunks.join('')).toBe(content);
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(8_000);
  });
});
