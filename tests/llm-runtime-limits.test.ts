import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  schemaVersion: 2,
  defaultProfileId: 'configured-default',
  profiles: {
    'configured-default': {
      provider: 'openai-compatible',
      model: 'budget-fixture',
      baseUrl: 'https://example.invalid/v1',
      credentialEnv: 'BUDGET_FIXTURE_API_KEY',
      maxRetries: 0,
      limits: {
        maxInputTokensPerRun: 100,
        maxOutputTokensPerRun: 50,
        maxEstimatedCostUsdPerRun: 1
      }
    },
    alternate: {
      provider: 'openai-compatible',
      model: 'alternate-fixture',
      baseUrl: 'https://example.invalid/v1',
      credentialEnv: 'BUDGET_FIXTURE_API_KEY',
      limits: null
    }
  }
}));
vi.mock('../config/llm.json', () => ({ default: fixture }));

import { getProfileLimits, LlmConfigError } from '@/lib/llm/config';
import { chat } from '@/lib/llm/client';
import { withLlmUsageBudget } from '@/lib/llm/usage-budget';

const envNames = [
  'WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN',
  'WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN',
  'WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN'
] as const;
const previousEnv = new Map<string, string | undefined>();

beforeEach(() => {
  previousEnv.clear();
  for (const name of envNames) {
    previousEnv.set(name, process.env[name]);
    delete process.env[name];
  }
});
afterEach(() => {
  for (const name of envNames) {
    const value = previousEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.unstubAllGlobals();
});

describe('runtime LLM limits with existing profile caps', () => {
  it('inherits approved profile caps only when overrides are absent', () => {
    expect(getProfileLimits()).toEqual({
      maxInputTokensPerRun: 100,
      maxOutputTokensPerRun: 50,
      maxEstimatedCostUsdPerRun: 1
    });
  });

  it('replaces only supplied fields and leaves the other profile caps intact', () => {
    process.env.WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN = '20';
    process.env.WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN = '0.5';

    expect(getProfileLimits()).toEqual({
      maxInputTokensPerRun: 20,
      maxOutputTokensPerRun: 50,
      maxEstimatedCostUsdPerRun: 0.5
    });
  });

  it.each([
    [envNames[0], ''],
    [envNames[0], 'bad-budget-value-sentinel'],
    [envNames[0], '1.5'],
    [envNames[0], '9007199254740992'],
    [envNames[1], ''],
    [envNames[1], 'bad-budget-value-sentinel'],
    [envNames[1], '-1'],
    [envNames[1], '9007199254740992'],
    [envNames[2], ''],
    [envNames[2], 'bad-budget-value-sentinel'],
    [envNames[2], 'Infinity'],
    [envNames[2], '0']
  ])('does not fall back to the old cap for invalid %s', (name, value) => {
    process.env[name] = value;

    expect(() => getProfileLimits()).toThrow(LlmConfigError);
    try {
      getProfileLimits();
    } catch (error) {
      expect(error).toMatchObject({ code: 'llm_budget_config_invalid' });
      expect((error as Error).message).not.toContain('bad-budget-value-sentinel');
    }
  });

  it('rejects invalid limits before the ordinary client can fetch or retry', async () => {
    process.env.WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN = 'bad-budget-value-sentinel';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      chat({ messages: [{ role: 'user', content: 'synthetic fixture' }], maxTokens: 1 })
    ).rejects.toMatchObject({ code: 'llm_budget_config_invalid' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects invalid limits before an operation wrapper calls its runner', async () => {
    process.env.WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN = 'bad-budget-value-sentinel';
    const runner = vi.fn();
    const guarded = withLlmUsageBudget(runner, 'synthetic budget fixture');

    await expect(
      guarded({ messages: [{ role: 'user', content: 'synthetic fixture' }] })
    ).rejects.toMatchObject({ code: 'llm_budget_config_invalid' });
    expect(runner).not.toHaveBeenCalled();
  });

  it('does not apply default-profile overrides to another declared profile', () => {
    process.env.WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN = 'bad-budget-value-sentinel';

    expect(getProfileLimits('alternate')).toBeNull();
  });
});
