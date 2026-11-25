import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  evaluateLocalDeployment,
  isLiteralLoopback,
  LOCAL_DEPLOYMENT_FACTS
} from '../scripts/local-preflight-contract.mjs';

type Service = {
  environment: Record<string, string>;
  ports?: Record<string, unknown>[] | null;
  network_mode?: string;
  volumes?: { type: string; source: string; target: string; read_only: boolean }[];
};

function fixture() {
  const connection = 'postgresql://fixture:private-password-sentinel@db:5432/fixture';
  const common = {
    DATABASE_URL: connection,
    DEEPSEEK_API_KEY: 'private-key-sentinel',
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:4310',
    WORLDLOOM_WORKER_MAX_CONCURRENCY: '1',
    WORLDLOOM_TLS_TERMINATED: 'false'
  };
  const mount = {
    type: 'bind',
    source: '/fixture-cache',
    target: '/app/.cache/worldloom-embeddings',
    read_only: true
  };
  const services: Record<string, Service> = {
    app: {
      environment: { ...common, WORLDLOOM_WORKER: 'false' },
      ports: [{ host_ip: '127.0.0.1', published: '4310', target: 4310, protocol: 'tcp' }],
      volumes: [{ ...mount }]
    },
    worker: { environment: { ...common, WORLDLOOM_WORKER: 'true' }, volumes: [{ ...mount }] },
    migrate: { environment: { DATABASE_URL: connection } },
    db: { environment: {}, ports: [{ host_ip: '127.0.0.1', published: '43133', target: 5432 }] }
  };
  return {
    compose: { services },
    config: {
      schemaVersion: 2,
      defaultProfileId: 'mock',
      profiles: {
        mock: {
          provider: 'openai-compatible',
          model: 'mock',
          baseUrl: 'https://provider.invalid',
          credentialEnv: 'DEEPSEEK_API_KEY',
          limits: null as Record<string, number | null> | null
        }
      },
      localEmbeddings: {
        enabled: true,
        model: 'Xenova/bge-m3',
        cacheDir: '.cache/worldloom-embeddings',
        dimensions: 1024,
        dtype: 'int8'
      },
      embeddings: { enabled: true, dimensions: 1024 }
    },
    facts: Object.fromEntries(LOCAL_DEPLOYMENT_FACTS.map(([name]) => [name, 'true'])),
    localFilesPresent: true,
    expectedCacheSource: '/fixture-cache'
  };
}
const failed = (input: ReturnType<typeof fixture>) =>
  evaluateLocalDeployment(input)
    .checks.filter((item: { status: string }) => item.status === 'FAIL')
    .map((item: { id: string }) => item.id);

describe('independent local single-user applicability contract', () => {
  it('accepts uncapped fixture declarations while explicitly not approving a release', () => {
    const report = evaluateLocalDeployment(fixture());

    expect(report.passed).toBe(true);
    expect(report.releaseApproved).toBe(false);
    expect(report.scope).toBe('local-single-user-uncapped-compose');
    expect(report.checks.filter((item: { status: string }) => item.status === 'N/A')).toHaveLength(
      4
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({ id: 'evidence.limit', status: 'WARN' })
    );
    expect(JSON.stringify(report)).not.toContain('private-password-sentinel');
    expect(JSON.stringify(report)).not.toContain('private-key-sentinel');
    expect(JSON.stringify(report)).not.toContain('/fixture-cache');
  });

  it.each(['0.0.0.0', '::', 'localhost', '127.0.0.1.evil.invalid', 'private-host-sentinel'])(
    'rejects a nonliteral or externally published host: %s',
    (host) => {
      const input = fixture();
      input.compose.services.db.ports = [{ host_ip: host, published: '43133', target: 5432 }];
      expect(failed(input)).toContain('compose.loopback');
      expect(JSON.stringify(evaluateLocalDeployment(input))).not.toContain('private-host-sentinel');
    }
  );

  it('rejects omitted/short-form bindings, shared networking and worker host ports', () => {
    const input = fixture();
    input.compose.services.app.ports = [{ published: '4310', target: 4310 }];
    input.compose.services.worker.network_mode = 'host';
    input.compose.services.worker.ports = [
      { host_ip: '127.0.0.1', published: '4312', target: 4310 }
    ];
    expect(failed(input)).toEqual(
      expect.arrayContaining(['compose.loopback', 'compose.private-worker'])
    );
  });

  it('fails malformed null port declarations without throwing or echoing input', () => {
    const input = fixture();
    input.compose.services.worker.ports = null;
    expect(failed(input)).toContain('compose.loopback');
    expect(failed(input)).toContain('compose.private-worker');
  });

  it.each([
    'https://external.invalid',
    'http://127.0.0.1:4311',
    'http://127.0.0.1:4310/path',
    'http://private-user-sentinel:private-password-sentinel@localhost:4310'
  ])('rejects noncanonical or unbound app origins: %s', (url) => {
    const input = fixture();
    input.compose.services.app.environment.NEXT_PUBLIC_APP_URL = url;
    expect(failed(input)).toContain('runtime.origin');
    expect(JSON.stringify(evaluateLocalDeployment(input))).not.toContain('private-user-sentinel');
  });

  it('accepts explicit IPv6 loopback without treating unspecified IPv6 as private', () => {
    const input = fixture();
    for (const name of ['app', 'worker']) {
      input.compose.services[name].environment.NEXT_PUBLIC_APP_URL = 'http://[::1]:4310';
    }
    input.compose.services.app.ports = [{ host_ip: '::1', published: '4310', target: 4310 }];
    expect(failed(input)).toEqual([]);
    expect(isLiteralLoopback('::')).toBe(false);
    expect(isLiteralLoopback('127.3.2.1')).toBe(true);
  });

  it('requires same database, explicit roles/concurrency and no false production claims', () => {
    const input = fixture();
    input.compose.services.worker.environment.DATABASE_URL = 'postgresql://fixture@db:5432/other';
    input.compose.services.app.environment.WORLDLOOM_WORKER = 'true';
    input.compose.services.worker.environment.WORLDLOOM_WORKER_MAX_CONCURRENCY = '1junk';
    input.compose.services.app.environment.NODE_ENV = 'development';
    input.compose.services.app.environment.WORLDLOOM_TLS_TERMINATED = 'true';
    expect(failed(input)).toEqual(
      expect.arrayContaining([
        'runtime.database',
        'runtime.roles',
        'runtime.concurrency',
        'runtime.node-env',
        'runtime.tls-mode'
      ])
    );
  });

  it('does not require a price or quota, but rejects configured personal-mode caps', () => {
    const input = fixture();
    input.config.profiles.mock.limits = { maxInputTokensPerRun: 100 };
    input.compose.services.worker.environment.WORLDLOOM_LLM_BUDGET_CNY = '';
    expect(failed(input)).toEqual(
      expect.arrayContaining(['llm.uncapped-profiles', 'llm.uncapped-runtime'])
    );
  });

  it('does not accept remote embedding credentials instead of local fallback files/mounts', () => {
    const input = fixture();
    input.compose.services.app.environment.EMBEDDINGS_API_KEY = 'remote-only-sentinel';
    input.localFilesPresent = false;
    input.compose.services.worker.volumes = [];
    input.config.embeddings.dimensions = 768;
    expect(failed(input)).toEqual(
      expect.arrayContaining(['embedding.files', 'embedding.mounts', 'embedding.dimensions'])
    );
  });

  it('retains every applicable evidence declaration rather than turning missing facts into N/A', () => {
    const input = fixture();
    input.facts = {};
    const failures = failed(input);
    for (const [name] of LOCAL_DEPLOYMENT_FACTS) expect(failures).toContain(`fact.${name}`);
    expect(evaluateLocalDeployment(input).passed).toBe(false);
  });
});

function runFixture(
  args: string[],
  options: {
    malformed?: boolean;
    implicitCredential?: boolean;
    oversized?: boolean;
  } = {}
) {
  const cwd = mkdtempSync(join(tmpdir(), 'worldloom-local-preflight-'));
  try {
    const input = fixture();
    const cache = join(cwd, '.cache/worldloom-embeddings');
    for (const name of ['app', 'worker']) {
      input.compose.services[name].volumes![0].source = cache;
      if (options.implicitCredential)
        delete input.compose.services[name].environment.DEEPSEEK_API_KEY;
    }
    const model = join(cache, 'Xenova/bge-m3');
    mkdirSync(join(model, 'onnx'), { recursive: true });
    for (const path of [
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'onnx/model_int8.onnx'
    ]) {
      writeFileSync(join(model, path), 'synthetic-placeholder-not-a-model');
    }
    mkdirSync(join(cwd, 'config'));
    writeFileSync(join(cwd, 'config/llm.json'), JSON.stringify(input.config));
    writeFileSync(
      join(cwd, 'resolved.json'),
      options.oversized
        ? ' '.repeat(2 * 1024 * 1024 + 1)
        : options.malformed
          ? '{private-json-sentinel'
          : JSON.stringify(input.compose)
    );
    writeFileSync(join(cwd, '.env.local'), 'DEEPSEEK_API_KEY=implicit-private-sentinel\n');
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/local-deployment-preflight.mjs'), ...args],
      {
        cwd,
        env: { ...input.facts, NODE_ENV: 'test' },
        encoding: 'utf8'
      }
    );
    return result;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe('local preflight CLI boundary (synthetic inputs only)', () => {
  it('produces safe machine-readable output without treating dummy model files as inference', () => {
    const result = runFixture(['--compose-config', 'resolved.json', '--json']);
    const report = JSON.parse(result.stdout);
    expect(result.status).toBe(0);
    expect(report.passed).toBe(true);
    expect(report.releaseApproved).toBe(false);
    expect(result.stdout).not.toContain('private-key-sentinel');
    expect(result.stdout).not.toContain('private-password-sentinel');
  });

  it.each([
    { args: [] },
    { args: ['--compose-config'] },
    { args: ['--strict'] },
    { args: ['--compose-config', 'resolved.json', '--config-only'] }
  ])('rejects missing input and bypass/strict options: %j', ({ args }) => {
    expect(runFixture(args).status).toBe(2);
  });

  it('does not load implicit dotenv or leak invalid JSON contents', () => {
    const missing = runFixture(['--compose-config', 'resolved.json'], { implicitCredential: true });
    expect(missing.status).toBe(1);
    expect(missing.stdout).not.toContain('implicit-private-sentinel');
    const malformed = runFixture(['--compose-config', 'resolved.json'], { malformed: true });
    expect(malformed.status).toBe(2);
    expect(malformed.stderr).not.toContain('private-json-sentinel');
    expect(malformed.stderr).not.toContain('resolved.json');
  });

  it('rejects oversized input without reading a model into memory', () => {
    const result = runFixture(['--compose-config', 'resolved.json'], { oversized: true });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('bounded regular JSON files');
  });

  it('keeps production strict independent from this local contract', () => {
    const original = readFileSync(resolve('scripts/deployment-preflight.mjs'), 'utf8');
    expect(original).toContain(
      'LLM operation token and estimated-cost limits are missing or invalid'
    );
    expect(original).toContain('WORLDLOOM_GATEWAY_AUTH_CONFIRMED');
    expect(original).not.toContain('local-preflight-contract');
  });

  it('binds host-run scripts to loopback without changing the container network boundary', () => {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    for (const name of ['dev', 'start', 'start:worker']) {
      expect(manifest.scripts[name]).toContain('--hostname 127.0.0.1');
    }
    const dockerfile = readFileSync(resolve('Dockerfile'), 'utf8');
    expect(dockerfile).toContain('HOSTNAME=0.0.0.0');
    expect(dockerfile).toContain('CMD ["server.js"]');
  });
});
