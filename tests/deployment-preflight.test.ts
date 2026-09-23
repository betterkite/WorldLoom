import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
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
  WORLDLOOM_WORKER_TOPOLOGY_CONFIRMED: 'false'
};

describe('deployment preflight', () => {
  it('passes local mode with explicit warnings instead of guessing deployment facts', () => {
    const output = execFileSync(process.execPath, [script], {
      cwd: process.cwd(),
      env: cleanEnvironment,
      encoding: 'utf8'
    });

    expect(output).toContain('WorldLoom deployment preflight (local)');
    expect(output).toContain('Deployment preflight passed for the selected mode.');
    expect(output).toContain('provider pricing table is configured');
    expect(output).toContain('token and estimated-cost limits are not fully configured');
    expect(output).toContain('gateway authentication: deployment fact is not confirmed');
    expect(output).toContain('WORLDLOOM_WORKER_MAX_CONCURRENCY is not explicit');
    expect(output).not.toContain('DEEPSEEK_API_KEY=');
  });

  it('accepts explicit runtime budget overrides without treating them as provider balance', () => {
    const output = execFileSync(process.execPath, [script], {
      cwd: process.cwd(),
      env: {
        ...cleanEnvironment,
        WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN: '120000',
        WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN: '24000',
        WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN: '1.5'
      },
      encoding: 'utf8'
    });

    expect(output).toContain('token and estimated-cost limits are configured');
    expect(output).not.toContain('balance');
  });

  it('fails strict mode until provider and production deployment facts are supplied', () => {
    const result = spawnSync(process.execPath, [script, '--strict', '--require-semantic'], {
      cwd: process.cwd(),
      env: { ...cleanEnvironment, NODE_ENV: 'production' },
      encoding: 'utf8'
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('provider pricing table is configured');
    expect(result.stdout).toContain('token and estimated-cost limits are missing or invalid');
    expect(result.stdout).toMatch(
      /credential is missing \(EMBEDDINGS_API_KEY\)|local embeddings\/Xenova\/bge-m3: model cache is (present|missing)/
    );
    expect(result.stdout).toContain('gateway authentication: deployment fact is not confirmed');
    expect(result.stdout).toContain(
      'production migration rollback drill: deployment fact is not confirmed'
    );
    expect(result.stdout).toContain(
      'WORLDLOOM_WORKER_MAX_CONCURRENCY must be an integer from 1 to 32'
    );
    expect(result.stdout).not.toContain('DEEPSEEK_API_KEY=');
  });
});
