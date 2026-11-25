import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';

describe('audit script fixture safety', () => {
  it('never deletes an existing same-prefix world and removes only its own fixture', async () => {
    const deletedIds: string[] = [];
    let createdWorldName = '';
    let changeCount = 0;
    const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');

      if (request.method === 'GET' && url.pathname === '/api/health/live') {
        return json(response, 200, { status: 'ok' });
      }
      if (request.method === 'GET' && url.pathname === '/api/health/ready') {
        return json(response, 200, { status: 'ready' });
      }
      if (request.method === 'GET' && url.pathname === '/api/worlds') {
        return json(response, 200, { worlds: [{ id: 'user-world', name: '审计世界-用户数据' }] });
      }
      if (request.method === 'POST' && url.pathname === '/api/worlds') {
        createdWorldName = JSON.parse(body).name;
        return json(response, 201, { world: { id: 'audit-run-world', name: createdWorldName } });
      }
      if (request.method === 'DELETE' && url.pathname.startsWith('/api/worlds/')) {
        deletedIds.push(url.pathname.split('/')[3] ?? '');
        return json(response, 200, { deleted: true });
      }
      if (request.method === 'POST' && url.pathname.endsWith('/changes')) {
        changeCount += 1;
        return json(response, 201, { change: { targetUid: `uid-${changeCount}` } });
      }
      if (request.method === 'GET' && url.pathname.endsWith('/export')) {
        response.writeHead(200, { 'content-type': 'application/zip' });
        response.end('P'.repeat(700));
        return;
      }
      if (url.pathname.endsWith('/search'))
        return json(response, 200, { hits: [{ uid: 'fixture-hit' }], mode: 'lexical' });
      if (url.pathname === '/api/mcp')
        return json(response, 200, { jsonrpc: '2.0', id: 1, result: {} });
      if (url.pathname.endsWith('/export/json')) return json(response, 200, { ok: true });
      if (url.pathname.startsWith('/api/worlds/') && url.pathname.endsWith('/evals')) {
        return json(response, 200, { score: 100 });
      }
      if (url.pathname.includes('/api/')) return json(response, 200, {});
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html>' + 'x'.repeat(1200));
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');

    const child = spawn(
      process.execPath,
      ['scripts/audit.mjs', `http://127.0.0.1:${address.port}`],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
    });

    try {
      const [exitCode] = await once(child, 'close');
      expect(exitCode, output).toBe(0);
      expect(createdWorldName).toMatch(/^审计世界-[0-9a-f-]{36}$/i);
      expect(deletedIds).toEqual(['audit-run-world']);
      expect(output).toContain('cleanup.world');
      expect(output).toContain('失败 0');
    } finally {
      if (child.exitCode === null) child.kill('SIGTERM');
      server.close();
    }
  }, 30_000);
});

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}
