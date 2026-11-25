import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deduplicateOnnxRuntime } from '../scripts/deduplicate-onnx-runtime.mjs';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'worldloom-onnx-payload-'));
  roots.push(root);
  const paths: Record<string, { canonical: string; traced: string }> = {};
  for (const name of ['onnxruntime-node', 'onnxruntime-common']) {
    const canonical = join(root, 'node_modules', name);
    const traced = join(root, 'node_modules/.pnpm', `${name}@1.30.0`, 'node_modules', name);
    mkdirSync(join(canonical, 'dist'), { recursive: true });
    writeFileSync(
      join(canonical, 'package.json'),
      JSON.stringify({ name, version: '1.30.0', main: 'dist/index.js' })
    );
    writeFileSync(
      join(canonical, 'dist/index.js'),
      name.endsWith('-node')
        ? "module.exports = require('onnxruntime-common');"
        : 'module.exports = { identity: 1 };'
    );
    if (name.endsWith('-node')) {
      mkdirSync(join(canonical, 'bin/napi-v6/linux/arm64'), { recursive: true });
      writeFileSync(
        join(canonical, 'bin/napi-v6/linux/arm64/onnxruntime_binding.node'),
        'arm64 fixture'
      );
    }
    cpSync(canonical, traced, { recursive: true });
    paths[name] = { canonical, traced };
  }
  return { root, paths };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('ONNX payload deduplication', () => {
  it('retains the selected platform once and resolves pnpm links to the same package', () => {
    const { root, paths } = fixture();
    const node = paths['onnxruntime-node'];
    mkdirSync(join(node.traced, 'bin/napi-v6/linux/x64'), { recursive: true });
    writeFileSync(
      join(node.traced, 'bin/napi-v6/linux/x64/onnxruntime_binding.node'),
      'foreign fixture'
    );
    const report = deduplicateOnnxRuntime(root);
    expect(report).toHaveLength(2);
    expect(report.find((p) => p.package === 'onnxruntime-node')?.discarded).toEqual([
      'bin/napi-v6/linux/x64/onnxruntime_binding.node'
    ]);
    expect(lstatSync(node.traced).isSymbolicLink()).toBe(true);
    expect(readlinkSync(node.traced)).not.toMatch(/^\//);
    expect(existsSync(join(node.traced, 'bin/napi-v6/linux/arm64/onnxruntime_binding.node'))).toBe(
      true
    );
    expect(existsSync(join(node.traced, 'bin/napi-v6/linux/x64'))).toBe(false);
    const require = createRequire(join(root, 'package.json'));
    expect(require(node.traced)).toBe(require(node.canonical));
    expect(deduplicateOnnxRuntime(root)).toEqual([]);
  });

  it.each(['version', 'bytes', 'symlink'])(
    'rejects %s mismatch before replacing either package',
    (kind) => {
      const { root, paths } = fixture();
      const common = paths['onnxruntime-common'];
      if (kind === 'version')
        writeFileSync(
          join(common.traced, 'package.json'),
          JSON.stringify({ name: 'onnxruntime-common', version: '0.0.0' })
        );
      if (kind === 'bytes')
        writeFileSync(join(common.traced, 'dist/index.js'), 'different content');
      if (kind === 'symlink')
        symlinkSync(
          join(common.canonical, 'dist/index.js'),
          join(common.traced, 'unexpected-link')
        );
      expect(() => deduplicateOnnxRuntime(root)).toThrow();
      expect(lstatSync(common.traced).isSymbolicLink()).toBe(false);
      expect(lstatSync(paths['onnxruntime-node'].traced).isSymbolicLink()).toBe(false);
    }
  );

  it('rejects canonical or pnpm roots redirected through symlinks', () => {
    const { root, paths } = fixture();
    const node = paths['onnxruntime-node'];
    rmSync(node.canonical, { recursive: true });
    symlinkSync(node.traced, node.canonical);
    expect(() => deduplicateOnnxRuntime(root)).toThrow('canonical ONNX package');
    rmSync(node.canonical);
    cpSync(node.traced, node.canonical, { recursive: true });
    const external = mkdtempSync(join(tmpdir(), 'worldloom-onnx-external-'));
    roots.push(external);
    rmSync(join(root, 'node_modules/.pnpm'), { recursive: true });
    symlinkSync(external, join(root, 'node_modules/.pnpm'));
    expect(() => deduplicateOnnxRuntime(root)).toThrow('module roots');
    expect(existsSync(node.canonical)).toBe(true);
  });
});
