import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { parseAcceptanceOptions, runAcceptance } from '../scripts/acceptance.mjs';

const options = { ...parseAcceptanceOptions([]), compileTimeoutMs: 30, pollIntervalMs: 1 };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });

function scenario(
  flags: {
    unavailable?: boolean;
    badDefault?: boolean;
    mismatch?: boolean;
    stageError?: boolean;
    running?: boolean;
    usageMissing?: boolean;
    deleteFailed?: boolean;
    semanticLexical?: boolean;
    autoMerge?: boolean;
  } = {}
) {
  let name = '';
  let deleted = false;
  let version = 1;
  let pending = 0;
  const logs: string[] = [];
  const world = () => ({
    id: 'acceptance-world',
    name: flags.mismatch ? '用户世界' : name,
    premise: '合成素材',
    masterVersion: version,
    pendingChanges: pending,
    master: { entities: version > 1 ? 3 : 0, events: version > 1 ? 2 : 0 }
  });
  const fetchFn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = new URL(String(input)).pathname;
    const method = init.method ?? 'GET';
    if (path === '/api/health')
      return json({
        status: 'ok',
        llm: {
          defaultProfile: flags.badDefault ? 'missing-default' : 'deepseek-official',
          profiles: [
            {
              profileId: 'deepseek-official',
              configured: !flags.unavailable,
              detected: !flags.unavailable
            }
          ],
          embeddings: { enabled: true, configured: true }
        }
      });
    if (path === '/api/worlds' && method === 'POST') {
      name = JSON.parse(String(init.body)).name;
      return json({ world: world() }, 201);
    }
    if (path === '/api/worlds/acceptance-world' && method === 'DELETE') {
      if (flags.deleteFailed) return json({ error: { message: 'private-upstream-body' } }, 500);
      deleted = true;
      return json({ deleted: true });
    }
    if (path === '/api/worlds/acceptance-world')
      return deleted ? json({}, 404) : json({ world: world() });
    if (flags.stageError && path.endsWith('/genesis/plan'))
      return json({ error: { message: 'private-upstream-body' } }, 502);
    if (path.endsWith('/genesis/plan')) return json({ plan: { epochs: [{}] } });
    if (path.endsWith('/genesis/commit')) {
      pending += 3;
      if (flags.autoMerge) version += 1;
      return json({ staged: 3 });
    }
    if (path.endsWith('/merge')) {
      version += 1;
      pending = 0;
      return json({});
    }
    if (path.endsWith('/sources')) return json({ source: { id: 'own-source' } }, 201);
    if (path.endsWith('/compile')) return json({ runId: 'own-run' }, 202);
    if (path.endsWith('/cancel')) return json({ run: { status: 'cancelled' } });
    if (path.endsWith('/compile-runs/own-run')) {
      if (flags.running) return json({ run: { status: 'running' } });
      pending += 2;
      return json({
        run: {
          status: 'completed',
          result: { staged: 2 },
          usage: { usageComplete: !flags.usageMissing, totalTokens: flags.usageMissing ? null : 80 }
        }
      });
    }
    if (path.endsWith('/lint')) return json({ version, counts: { error: 0 } });
    if (path.endsWith('/ask'))
      return json({ answer: '云隐子 [1]', citations: [{ n: 1, uid: 'valid-uid' }] });
    if (path.endsWith('/search'))
      return json({
        hits: [{ uid: 'valid-uid' }],
        mode: flags.semanticLexical ? 'lexical' : 'hybrid',
        semantic: { fresh: true }
      });
    if (path.endsWith('/continuations'))
      return json({ candidates: [{ id: 'own-candidate', kind: 'event_suggestion' }] });
    if (path.endsWith('/accept')) {
      pending += 1;
      return json({ acceptedChangeUid: 'change-uid' });
    }
    if (path.endsWith('/semantic-index'))
      return json(
        { indexed: 3, semantic: { fresh: true, indexed: 3 }, job: { status: 'completed' } },
        method === 'POST' ? 202 : 200
      );
    if (path.endsWith('/export')) return new Response('PK' + 'x'.repeat(1100));
    if (path === '/api/mcp')
      return json({ result: { content: [{ text: JSON.stringify({ hits: [{}] }) }] } });
    throw new Error('unexpected mock path');
  });
  return { fetchFn, logs, getName: () => name, log: (value: string) => logs.push(value) };
}

describe('real-model acceptance fixture safety', () => {
  it.each([{ unavailable: true }, { badDefault: true }])(
    'creates nothing when the default model is unavailable: %j',
    async (flags) => {
      const mock = scenario(flags);
      const result = await runAcceptance(options, mock);
      expect(result.failures).toBeGreaterThan(0);
      expect(result.worldId).toBeNull();
      expect(mock.fetchFn).toHaveBeenCalledTimes(1);
    }
  );

  it('runs the contract chain and deletes only its own unique fixture', async () => {
    const mock = scenario();
    const result = await runAcceptance(options, mock);
    expect(result.failures, mock.logs.join('\n')).toBe(0);
    expect(mock.getName()).toMatch(/^验收世界-[0-9a-f-]{36}$/);
    const deletes = mock.fetchFn.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    expect(deletes.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/api/worlds/acceptance-world'
    ]);
    expect(mock.logs.join('\n')).toContain('cleanup.world');
  });

  it('keeps the fixture only with the explicit keep-world option', async () => {
    const mock = scenario();
    const result = await runAcceptance({ ...options, keepWorld: true }, mock);
    expect(result.failures).toBe(0);
    expect(mock.fetchFn.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    expect(mock.logs.join('\n')).toContain('KEEP');
  });

  it('never deletes a world when the response identity is not its fixture', async () => {
    const mock = scenario({ mismatch: true });
    const result = await runAcceptance(options, mock);
    expect(result.failures).toBeGreaterThan(0);
    expect(mock.fetchFn.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it('cleans up after a failed stage without logging private upstream text', async () => {
    const mock = scenario({ stageError: true });
    const result = await runAcceptance(options, mock);
    expect(result.failures).toBeGreaterThan(0);
    expect(mock.logs.join('\n')).toContain('HTTP 502');
    expect(mock.logs.join('\n')).not.toContain('private-upstream-body');
    expect(mock.fetchFn.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
  });

  it('cancels a timed-out owned compile before any further model stage', async () => {
    const mock = scenario({ running: true });
    const result = await runAcceptance(options, mock);
    expect(result.failures).toBeGreaterThan(0);
    const paths = mock.fetchFn.mock.calls.map(([url]) => new URL(String(url)).pathname);
    const cancel = paths.findIndex((path) => path.endsWith('/own-run/cancel'));
    expect(cancel).toBeGreaterThan(0);
    expect(cancel).toBeLessThan(paths.findIndex((path) => path.endsWith('/ask')));
    expect(mock.logs.join('\n')).toContain('cleanup.world');
  });

  it.each([
    { usageMissing: true },
    { semanticLexical: true },
    { autoMerge: true },
    { deleteFailed: true }
  ])(
    'rejects incomplete usage, lexical-only semantic proof, broken review, or failed cleanup: %j',
    async (flags) => {
      const mock = scenario(flags);
      const result = await runAcceptance(options, mock);
      expect(result.failures).toBeGreaterThan(0);
      expect(mock.logs.join('\n')).not.toContain('private-upstream-body');
    }
  );

  it('bounds a real HTTP request that never sends a response', async () => {
    const server = createServer(() => {});
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed');
    try {
      const result = await runAcceptance(
        { ...options, baseUrl: `http://127.0.0.1:${address.port}`, requestTimeoutMs: 40 },
        { log: () => {} }
      );
      expect(result.failures).toBeGreaterThan(0);
      expect(result.worldId).toBeNull();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});

describe('acceptance CLI options', () => {
  it('parses documented origin, keep flag, and bounded timeouts', () => {
    expect(
      parseAcceptanceOptions([
        '--',
        'http://127.0.0.1:4311',
        '--keep-world',
        '--compile-timeout-ms=1000'
      ])
    ).toMatchObject({ baseUrl: 'http://127.0.0.1:4311', keepWorld: true, compileTimeoutMs: 1000 });
  });
  it.each([
    '--bad',
    '--request-timeout-ms=0',
    '--request-timeout-ms=1000=extra',
    'http://user:pass@localhost',
    'file:///tmp',
    'https://host/path'
  ])('rejects invalid or credential-bearing arguments: %s', (arg) => {
    expect(() => parseAcceptanceOptions([arg])).toThrow();
  });
});
