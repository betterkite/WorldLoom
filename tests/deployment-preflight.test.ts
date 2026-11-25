import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(process.cwd(), 'scripts/deployment-preflight.mjs');
const cleanEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: '',
  DEEPSEEK_API_KEY: '',
  EMBEDDINGS_API_KEY: '',
  NODE_ENV: 'test',
  NEXT_PUBLIC_APP_URL: '',
  WORLDLOOM_TLS_TERMINATED: 'false',
  WORLDLOOM_WORKER: 'false',
  WORLDLOOM_GATEWAY_AUTH_CONFIRMED: 'false',
  WORLDLOOM_RATE_LIMIT_CONFIRMED: 'false',
  WORLDLOOM_BACKUP_RESTORE_CONFIRMED: 'false',
  WORLDLOOM_MIGRATION_ROLLBACK_CONFIRMED: 'false',
  WORLDLOOM_TARGET_SCALE_CONFIRMED: 'false',
  WORLDLOOM_WORKER_TOPOLOGY_CONFIRMED: 'false',
  WORLDLOOM_SUPPLY_CHAIN_CONFIRMED: 'false',
  WORLDLOOM_OBSERVABILITY_CONFIRMED: 'false',
  WORLDLOOM_PRIVACY_CONFIRMED: 'false'
};
// Do not inherit an operator's real aggregate budget or private ledger path.
delete cleanEnvironment.WORLDLOOM_LLM_BUDGET_CNY;
delete cleanEnvironment.WORLDLOOM_LLM_BUDGET_LEDGER;
delete cleanEnvironment.WORLDLOOM_WORKER_MAX_CONCURRENCY;
delete cleanEnvironment.WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN;
delete cleanEnvironment.WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN;
delete cleanEnvironment.WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN;

function cnyConfig(pricingOverrides: Record<string, unknown> | null = {}) {
  const config = JSON.parse(readFileSync(resolve(process.cwd(), 'config/llm.json'), 'utf8'));
  config.profiles[config.defaultProfileId].pricingCny =
    pricingOverrides === null
      ? null
      : {
          inputPerMillion: 2,
          outputPerMillion: 8,
          sourceUrl: 'https://example.invalid/pricing',
          checkedAt: new Date().toISOString().slice(0, 10),
          ...pricingOverrides
        };
  return JSON.stringify(config);
}

function runInIsolatedProject(
  files: Record<string, string>,
  args: string[],
  env: Partial<NodeJS.ProcessEnv> = { NODE_ENV: 'production' }
) {
  const cwd = mkdtempSync(join(tmpdir(), 'worldloom-preflight-'));
  try {
    mkdirSync(join(cwd, 'config'));
    copyFileSync(resolve(process.cwd(), 'config/llm.json'), join(cwd, 'config/llm.json'));
    for (const [path, content] of Object.entries(files)) {
      writeFileSync(join(cwd, path), content);
    }
    const isolatedEnv: NodeJS.ProcessEnv = {
      ...cleanEnvironment,
      ...env,
      NODE_ENV: env.NODE_ENV ?? 'production'
    };
    delete isolatedEnv.DEEPSEEK_API_KEY;
    delete isolatedEnv.EMBEDDINGS_API_KEY;
    delete isolatedEnv.WORLDLOOM_PREFLIGHT_STRICT;
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd,
      env: isolatedEnv,
      encoding: 'utf8'
    });
    return result;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe('deployment preflight', () => {
  it('passes local mode with explicit warnings instead of guessing deployment facts', () => {
    const result = runInIsolatedProject({}, []);
    const output = result.stdout;

    expect(result.status).toBe(0);
    expect(output).toContain('WorldLoom deployment preflight (local)');
    expect(output).toContain('Deployment preflight passed for the selected mode.');
    expect(output).toContain('provider pricing table is configured');
    expect(output).toContain('provider pricing evidence timestamp is recent');
    expect(output).toContain('token and estimated-cost limits are not fully configured');
    expect(output).toContain('gateway authentication: deployment fact is not confirmed');
    expect(output).toContain('WORLDLOOM_WORKER_MAX_CONCURRENCY is not explicit');
    expect(output).not.toContain('DEEPSEEK_API_KEY=');
  });

  it('accepts explicit runtime budget overrides without treating them as provider balance', () => {
    const result = runInIsolatedProject({}, [], {
      WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN: '120000',
      WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN: '24000',
      WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN: '1.5'
    });
    const output = result.stdout;

    expect(result.status).toBe(0);
    expect(output).toContain('LLM operation token and estimated-cost limits are configured');
    expect(output).not.toContain('balance');
  });

  it.each([
    ['WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN', 'private-invalid-budget-sentinel'],
    ['WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN', '9007199254740992'],
    ['WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN', 'private-invalid-budget-sentinel']
  ])('rejects invalid explicit %s even in local mode with existing caps', (name, value) => {
    const config = JSON.parse(cnyConfig());
    config.profiles[config.defaultProfileId].limits = {
      maxInputTokensPerRun: 100,
      maxOutputTokensPerRun: 50,
      maxEstimatedCostUsdPerRun: 1
    };
    const result = runInIsolatedProject({ 'config/llm.json': JSON.stringify(config) }, [], {
      [name]: value
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`${name} must be a positive`);
    expect(result.stdout).not.toContain('private-invalid-budget-sentinel');
    expect(result.stdout).not.toContain(
      'LLM operation token and estimated-cost limits are configured'
    );
  });

  it('rejects malformed worker concurrency instead of parsing a numeric prefix', () => {
    const result = runInIsolatedProject({}, ['--strict'], {
      NODE_ENV: 'production',
      WORLDLOOM_WORKER_MAX_CONCURRENCY: '4junk'
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      'WORLDLOOM_WORKER_MAX_CONCURRENCY must be an integer from 1 to 32 in strict deployment mode'
    );
    expect(result.stdout).not.toContain('in-process task cap is explicit');
  });

  it('fails strict mode until provider and production deployment facts are supplied', () => {
    const result = runInIsolatedProject({}, ['--strict', '--require-semantic']);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('provider pricing table is configured');
    expect(result.stdout).toContain(
      'LLM operation token and estimated-cost limits are missing or invalid'
    );
    expect(result.stdout).toMatch(
      /credential variable is empty or missing \(EMBEDDINGS_API_KEY\)|local embeddings\/Xenova\/bge-m3: model cache is (present|missing)/
    );
    expect(result.stdout).toContain('gateway authentication: deployment fact is not confirmed');
    expect(result.stdout).toContain(
      'production migration rollback drill: deployment fact is not confirmed'
    );
    expect(result.stdout).toContain(
      'supply-chain SBOM/provenance and vulnerability review: deployment fact is not confirmed'
    );
    expect(result.stdout).toContain(
      'privacy and data-lifecycle review: deployment fact is not confirmed'
    );
    expect(result.stdout).toContain(
      'WORLDLOOM_WORKER_MAX_CONCURRENCY must be an integer from 1 to 32'
    );
    expect(result.stdout).not.toContain('DEEPSEEK_API_KEY=');
  });

  it('does not treat a local Next.js dotenv secret as an injected strict runtime credential', () => {
    const result = runInIsolatedProject(
      { '.env.local': 'DEEPSEEK_API_KEY=local-only-sentinel\n' },
      ['--strict']
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('credential variable is empty or missing (DEEPSEEK_API_KEY)');
    expect(result.stdout).not.toContain('credential variable is non-empty (DEEPSEEK_API_KEY)');
    expect(result.stdout).not.toContain('local-only-sentinel');
  });

  it('loads only an explicitly selected env file in strict mode without printing its values', () => {
    const result = runInIsolatedProject(
      { '.runtime.env': 'DEEPSEEK_API_KEY=explicit-file-sentinel\n' },
      ['--strict', '--runtime-env-file', '.runtime.env']
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('credential variable is non-empty (DEEPSEEK_API_KEY)');
    expect(result.stdout).not.toContain('explicit-file-sentinel');
  });

  it('fails closed when an explicitly selected env file does not exist', () => {
    const result = runInIsolatedProject({}, ['--strict', '--runtime-env-file', 'missing.env']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('must point to an existing regular file');
  });

  it('uses .env.local over .env for local developer preflight', () => {
    const result = runInIsolatedProject(
      {
        '.env': 'DEEPSEEK_API_KEY=compose-env-sentinel\n',
        '.env.local': 'DEEPSEEK_API_KEY=\n'
      },
      []
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('credential variable is empty or missing (DEEPSEEK_API_KEY)');
    expect(result.stdout).not.toContain('compose-env-sentinel');
  });

  it('keeps the aggregate guard opt-in and does not claim an unconfigured cap', () => {
    const result = runInIsolatedProject({}, []);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Cumulative CNY budget guard is disabled');
    expect(result.stdout).not.toContain('cumulative application cap is configured');
  });

  it.each([
    { WORLDLOOM_LLM_BUDGET_CNY: '5' },
    { WORLDLOOM_LLM_BUDGET_LEDGER: '/private-ledger-sentinel/budget.json' }
  ])('rejects a partially configured aggregate guard: %j', (env) => {
    const result = runInIsolatedProject({}, [], env);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('must be configured together');
    expect(result.stdout).not.toContain('private-ledger-sentinel');
  });

  it.each(['', '0', '-5', '0.0000001', '5junk', '1e30'])(
    'rejects an invalid aggregate amount in local mode: %j',
    (amount) => {
      const result = runInIsolatedProject({}, [], {
        WORLDLOOM_LLM_BUDGET_CNY: amount,
        WORLDLOOM_LLM_BUDGET_LEDGER: '/private-ledger-sentinel/budget.json'
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('representable as safe integer micro-CNY');
      expect(result.stdout).not.toContain('private-ledger-sentinel');
    }
  );

  it.each(['', 'relative-private-ledger-sentinel.json'])(
    'rejects an empty or relative aggregate ledger path: %j',
    (ledger) => {
      const result = runInIsolatedProject({}, [], {
        WORLDLOOM_LLM_BUDGET_CNY: '5',
        WORLDLOOM_LLM_BUDGET_LEDGER: ledger
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('must be a non-empty absolute path');
      expect(result.stdout).not.toContain('relative-private-ledger-sentinel');
    }
  );

  it.each([null, { inputPerMillion: 0 }, { outputPerMillion: -1 }, { inputPerMillion: '2' }])(
    'rejects missing or invalid CNY rates: %j',
    (pricing) => {
      const result = runInIsolatedProject({ 'config/llm.json': cnyConfig(pricing) }, [], {
        WORLDLOOM_LLM_BUDGET_CNY: '5',
        WORLDLOOM_LLM_BUDGET_LEDGER: '/private-ledger-sentinel/budget.json'
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        'positive finite CNY reservation prices are missing or invalid'
      );
    }
  );

  it.each([
    { sourceUrl: 'http://example.invalid/pricing' },
    { checkedAt: '2000-01-01' },
    { checkedAt: '9999-01-01' },
    { checkedAt: '2026-02-30' }
  ])('rejects invalid, stale or future CNY source metadata: %j', (pricing) => {
    const result = runInIsolatedProject({ 'config/llm.json': cnyConfig(pricing) }, [], {
      WORLDLOOM_LLM_BUDGET_CNY: '5',
      WORLDLOOM_LLM_BUDGET_LEDGER: '/private-ledger-sentinel/budget.json'
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('require an HTTPS source and checkedAt within 90 days');
  });

  it('checks valid CNY metadata without opening a ledger or treating it as verified billing', () => {
    // An absent parent path is intentional: this check must not read or create it.
    const result = runInIsolatedProject({ 'config/llm.json': cnyConfig() }, [], {
      WORLDLOOM_LLM_BUDGET_CNY: '5',
      WORLDLOOM_LLM_BUDGET_LEDGER: '/private-ledger-sentinel/missing-parent/budget.json'
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('cumulative application cap is configured');
    expect(result.stdout).toContain('CNY price source URL/date metadata are recent');
    expect(result.stdout).toContain('provider terms remain unverified');
    expect(result.stdout).toContain('default profile only');
    expect(result.stdout).not.toContain('private-ledger-sentinel');
    expect(result.stdout).not.toContain('balance');
  });

  it('does not let valid aggregate configuration bypass existing strict release gates', () => {
    const result = runInIsolatedProject({ 'config/llm.json': cnyConfig() }, ['--strict'], {
      WORLDLOOM_LLM_BUDGET_CNY: '5',
      WORLDLOOM_LLM_BUDGET_LEDGER: '/private-ledger-sentinel/budget.json'
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('cumulative application cap is configured');
    expect(result.stdout).toContain(
      'LLM operation token and estimated-cost limits are missing or invalid'
    );
    expect(result.stdout).toContain('gateway authentication: deployment fact is not confirmed');
  });
});
