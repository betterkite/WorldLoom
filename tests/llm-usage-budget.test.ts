import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequest, ChatResult } from '@/lib/llm/client';
import { LlmUsageBudgetError, withLlmUsageBudget } from '@/lib/llm/usage-budget';
import { errorResponse } from '@/lib/api';

const budgetEnvNames = [
  'WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN',
  'WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN',
  'WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN'
] as const;

const previousEnv = new Map<string, string | undefined>();

function result(inputTokens: number, outputTokens: number): ChatResult {
  return {
    content: 'mock response',
    profileId: 'deepseek-official',
    model: 'deepseek-flash',
    usage: { inputTokens, outputTokens },
    latencyMs: 1
  };
}

function request(maxTokens?: number): ChatRequest {
  return {
    messages: [{ role: 'user', content: 'mock prompt' }],
    ...(maxTokens === undefined ? {} : { maxTokens })
  };
}

describe('operation-scoped LLM usage budget', () => {
  beforeEach(() => {
    previousEnv.clear();
    for (const name of budgetEnvNames) {
      previousEnv.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of budgetEnvNames) {
      const value = previousEnv.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('caps output to the remaining operation allowance and prevents later calls', async () => {
    process.env.WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN = '5';
    const requests: ChatRequest[] = [];
    const runner = vi.fn(async (value: ChatRequest) => {
      requests.push(value);
      return result(2, value.maxTokens === 3 ? 3 : 2);
    });
    const guarded = withLlmUsageBudget(runner, 'test operation');

    await guarded(request(10));
    await guarded(request(10));
    await expect(guarded(request(10))).rejects.toBeInstanceOf(LlmUsageBudgetError);

    expect(requests.map((value) => value.maxTokens)).toEqual([5, 3]);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('stops and latches the budget error when a provider exceeds a capped response', async () => {
    process.env.WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN = '4';
    const runner = vi.fn(async () => result(1, 5));
    const guarded = withLlmUsageBudget(runner, 'test operation');

    await expect(guarded(request(10))).rejects.toMatchObject({ code: 'llm_budget_exceeded' });
    await expect(guarded(request(10))).rejects.toMatchObject({ code: 'llm_budget_exceeded' });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a configured budget cannot be checked from usage', async () => {
    process.env.WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN = '100';
    const runner = vi.fn(
      async (): Promise<ChatResult> => ({
        ...result(0, 0),
        usage: null
      })
    );
    const guarded = withLlmUsageBudget(runner, 'test operation');

    await expect(guarded(request(10))).rejects.toMatchObject({
      code: 'llm_budget_exceeded',
      operation: 'test operation'
    });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('fails closed when reported provider identity differs from the priced profile', async () => {
    process.env.WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN = '1';
    const runner = vi.fn(async () => ({ ...result(1, 1), profileId: 'unpriced-profile' }));
    const guarded = withLlmUsageBudget(runner, 'test operation');

    await expect(guarded(request(10))).rejects.toMatchObject({ code: 'llm_budget_exceeded' });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('enforces estimated cost using the configured profile pricing', async () => {
    process.env.WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN = '0.000001';
    const runner = vi.fn(async () => result(10, 10));
    const guarded = withLlmUsageBudget(runner, 'test operation');

    await expect(guarded(request(20))).rejects.toMatchObject({ code: 'llm_budget_exceeded' });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('does not alter calls when no budget is configured', async () => {
    const input = request(20);
    const runner = vi.fn(
      async (): Promise<ChatResult> => ({
        ...result(0, 0),
        usage: null
      })
    );
    const guarded = withLlmUsageBudget(runner, 'test operation');

    await expect(guarded(input)).resolves.toMatchObject({ usage: null });
    expect(runner).toHaveBeenCalledWith(input);
  });

  it('returns a sanitized HTTP 429 for a budget rejection', async () => {
    const response = errorResponse(
      new LlmUsageBudgetError('answer evaluation', 'deepseek-official', 'private usage details')
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toMatchObject({ code: 'llm_budget_exceeded' });
    expect(JSON.stringify(body)).not.toContain('private usage details');
    expect(response.headers.get('x-correlation-id')).toBeTruthy();
  });
});
