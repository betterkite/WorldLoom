import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'worldloom-client-marker-'));
  roots.push(root);
  mkdirSync(join(root, 'node_modules'));
  cpSync(resolve('packages/client-only'), join(root, 'node_modules/client-only'), {
    recursive: true
  });
  return root;
}

function node(root: string, source: string, flags: string[] = []) {
  return spawnSync(process.execPath, [...flags, '-e', source], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    env: { PATH: process.env.PATH, NODE_ENV: 'production' }
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('local client boundary marker', () => {
  it('loads through CommonJS and ESM without side effects in the default environment', () => {
    const root = fixture();
    const cjs = node(root, "require('client-only'); console.log('loaded')");
    expect(cjs.status).toBe(0);
    expect(cjs.stdout.trim()).toBe('loaded');
    const esm = node(root, "import 'client-only'; console.log('loaded')", ['--input-type=module']);
    expect(esm.status).toBe(0);
    expect(esm.stdout.trim()).toBe('loaded');
  });

  it('rejects both module systems under the react-server export condition', () => {
    const root = fixture();
    for (const [source, flags] of [
      ["require('client-only')", []],
      ["import 'client-only'", ['--input-type=module']]
    ] as const) {
      const result = node(root, source, ['--conditions=react-server', ...flags]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('WorldLoom: a client boundary was imported');
    }
  });

  it('preserves the installed styled-jsx server rendering entry', () => {
    const root = fixture();
    const nextRequire = createRequire(require.resolve('next/package.json'));
    cpSync(
      dirname(nextRequire.resolve('styled-jsx/package.json')),
      join(root, 'node_modules/styled-jsx'),
      {
        recursive: true
      }
    );
    symlinkSync(dirname(require.resolve('react/package.json')), join(root, 'node_modules/react'));
    const result = node(
      root,
      "const jsx = require('styled-jsx'); const registry = jsx.createStyleRegistry(); " +
        "registry.add({id:'local-marker',children:'.marker{color:red}'}); " +
        "if (registry.styles().length !== 1) process.exit(1); console.log('styled-jsx ready');"
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('styled-jsx ready');
  });
});
