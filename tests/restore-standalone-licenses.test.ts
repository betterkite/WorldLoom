import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { restoreStandaloneLicenses } from '../scripts/restore-standalone-licenses.mjs';
import { inventoryRuntimePackages } from '../scripts/runtime-license-audit.mjs';

const temporaryRoots: string[] = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'worldloom-standalone-licenses-'));
  temporaryRoots.push(directory);
  const source = join(directory, 'source');
  const artifact = join(directory, 'artifact');
  mkdirSync(join(source, 'node_modules'), { recursive: true });
  mkdirSync(join(artifact, 'node_modules'), { recursive: true });
  return { source, artifact };
}

function addPackage(root: string, name: string, version: string, notice?: string) {
  const directory = join(root, 'node_modules', name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version, license: 'MIT' }));
  if (notice !== undefined) writeFileSync(join(directory, 'LICENSE'), notice);
  return directory;
}

function vendoredFixture(options: { metadata?: boolean; notice?: string } = {}) {
  const { source, artifact } = fixture();
  addPackage(source, 'next', '16.3.5', 'Original Next notice');
  const next = addPackage(artifact, 'next', '16.3.5');
  const locations = [source, artifact].map((root) => {
    const directory = join(root, 'node_modules/next/dist/compiled/fixture-component');
    mkdirSync(join(directory, 'cjs'), { recursive: true });
    writeFileSync(join(directory, 'cjs/index.js'), 'export const fixture = true;\n');
    if (options.metadata !== false) {
      writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({ name: 'fixture-component', license: 'MIT' })
      );
    }
    return directory;
  });
  if (options.notice !== undefined) writeFileSync(join(locations[0], 'LICENSE'), options.notice);
  return { source, artifact, next, original: locations[0], target: locations[1] };
}

function sharpFixture() {
  const { source, artifact } = fixture();
  const name = '@img/sharp-libvips-linux-arm64';
  const original = addPackage(source, name, '1.3.3', 'Original notice');
  const target = addPackage(artifact, name, '1.3.3');
  for (const root of [original, target]) {
    mkdirSync(join(root, 'lib'));
    writeFileSync(join(root, 'lib/libvips.so.8'), 'synthetic native bytes; never executed');
  }
  const declaration = '{\n  "vips": "8.18.6",\n  "glib": "2.89.4"\n}\n';
  writeFileSync(join(original, 'versions.json'), declaration);
  return { source, artifact, original, target, declaration };
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('standalone license restoration', () => {
  it('restores omitted Sharp component declarations and makes the actual inventory readable', () => {
    const { source, artifact, target, declaration } = sharpFixture();
    expect(() => inventoryRuntimePackages(artifact)).toThrow(/ENOENT/);
    const binary = readFileSync(join(target, 'lib/libvips.so.8'));
    const result = restoreStandaloneLicenses(source, artifact);
    expect(result).toMatchObject({ restoredDeclarationCount: 1, copiedFileCount: 2 });
    expect(result.componentVersionDeclarations[0].verifiedFiles).toHaveLength(2);
    expect(readFileSync(join(target, 'versions.json'), 'utf8')).toBe(declaration);
    expect(readFileSync(join(target, 'lib/libvips.so.8'))).toEqual(binary);
    expect(inventoryRuntimePackages(artifact).bundledComponentVersionDeclarations[0]).toMatchObject(
      {
        package: '@img/sharp-libvips-linux-arm64@1.3.3',
        versions: { vips: '8.18.6', glib: '2.89.4' }
      }
    );
    expect(restoreStandaloneLicenses(source, artifact)).toMatchObject({
      copiedFileCount: 0,
      restoredDeclarationCount: 0
    });
  });

  it('rejects changed Sharp binary or package bytes before copying any notices', () => {
    for (const filename of ['lib/libvips.so.8', 'package.json']) {
      const item = sharpFixture();
      const path = join(item.target, filename);
      writeFileSync(
        path,
        filename.endsWith('.json')
          ? JSON.stringify({
              name: '@img/sharp-libvips-linux-arm64',
              version: '1.3.3',
              license: 'MIT',
              altered: true
            })
          : 'different binary'
      );
      expect(() => restoreStandaloneLicenses(item.source, item.artifact)).toThrow(/bytes differ/);
      expect(existsSync(join(item.target, 'LICENSE'))).toBe(false);
      expect(existsSync(join(item.target, 'versions.json'))).toBe(false);
    }
  });

  it('rejects missing, malformed or differently versioned Sharp source declarations', () => {
    for (const value of [null, '{}', '{"vips":8}', 'not JSON']) {
      const item = sharpFixture();
      const path = join(item.original, 'versions.json');
      if (value === null) rmSync(path);
      else writeFileSync(path, value);
      expect(() => restoreStandaloneLicenses(item.source, item.artifact)).toThrow();
      expect(existsSync(join(item.target, 'LICENSE'))).toBe(false);
    }
    const item = sharpFixture();
    writeFileSync(
      join(item.original, 'package.json'),
      JSON.stringify({
        name: '@img/sharp-libvips-linux-arm64',
        version: '1.3.4',
        license: 'MIT'
      })
    );
    expect(() => restoreStandaloneLicenses(item.source, item.artifact)).toThrow(
      /no exact-version Sharp source/
    );
    expect(existsSync(join(item.target, 'versions.json'))).toBe(false);
  });

  it('rejects altered or symlinked Sharp declarations without overwriting them', () => {
    const changed = sharpFixture();
    writeFileSync(join(changed.target, 'versions.json'), '{"vips":"different"}');
    expect(() => restoreStandaloneLicenses(changed.source, changed.artifact)).toThrow(/differs/);
    expect(readFileSync(join(changed.target, 'versions.json'), 'utf8')).toBe(
      '{"vips":"different"}'
    );
    expect(existsSync(join(changed.target, 'LICENSE'))).toBe(false);
    for (const role of ['original', 'target'] as const) {
      const item = sharpFixture();
      const path = join(item[role], 'versions.json');
      if (role === 'original') rmSync(path);
      const sibling = join(item[role], 'declaration-alias');
      for (const root of [item.original, item.target])
        writeFileSync(join(root, 'declaration-alias'), item.declaration);
      symlinkSync(sibling, path);
      expect(() => restoreStandaloneLicenses(item.source, item.artifact)).toThrow(
        /regular file|symlink/
      );
      expect(existsSync(join(item.target, 'LICENSE'))).toBe(false);
    }
  });

  it('rejects symlinked Sharp source binary paths', () => {
    const item = sharpFixture();
    const path = join(item.original, 'lib/libvips.so.8');
    rmSync(path);
    symlinkSync(join(item.target, 'lib/libvips.so.8'), path);
    expect(() => restoreStandaloneLicenses(item.source, item.artifact)).toThrow(/symlink/);
    expect(existsSync(join(item.target, 'versions.json'))).toBe(false);
    expect(existsSync(join(item.target, 'LICENSE'))).toBe(false);
  });

  it('compares nested versions.json as traced payload rather than the root declaration', () => {
    const item = sharpFixture();
    writeFileSync(join(item.original, 'lib/versions.json'), '{"nested":"original"}');
    writeFileSync(join(item.target, 'lib/versions.json'), '{"nested":"changed"}');
    expect(() => restoreStandaloneLicenses(item.source, item.artifact)).toThrow(/bytes differ/);
    expect(existsSync(join(item.target, 'versions.json'))).toBe(false);
    expect(existsSync(join(item.target, 'LICENSE'))).toBe(false);
  });

  it('refuses conflicting declarations across installations with the same Sharp version', () => {
    const item = sharpFixture();
    const secondRoot = join(item.source, 'node_modules/.pnpm/duplicate');
    const second = addPackage(
      secondRoot,
      '@img/sharp-libvips-linux-arm64',
      '1.3.3',
      'Original notice'
    );
    mkdirSync(join(second, 'lib'));
    copyFileSync(join(item.original, 'lib/libvips.so.8'), join(second, 'lib/libvips.so.8'));
    writeFileSync(join(second, 'versions.json'), '{"vips":"different"}');
    expect(() => restoreStandaloneLicenses(item.source, item.artifact)).toThrow(
      /conflicting Sharp source declarations/
    );
    expect(existsSync(join(item.target, 'LICENSE'))).toBe(false);
    expect(existsSync(join(item.target, 'versions.json'))).toBe(false);
  });

  it('copies exact-version source text into each traced package location', () => {
    const { source, artifact } = fixture();
    addPackage(source, 'react', '19.2.4', 'React MIT license');
    const target = addPackage(artifact, 'react', '19.2.4');
    const pnpmPackage = join(
      artifact,
      'node_modules',
      '.pnpm',
      'react@19.2.4',
      'node_modules',
      'react'
    );
    mkdirSync(pnpmPackage, { recursive: true });
    writeFileSync(
      join(pnpmPackage, 'package.json'),
      JSON.stringify({ name: 'react', version: '19.2.4', license: 'MIT' })
    );

    expect(restoreStandaloneLicenses(source, artifact)).toMatchObject({
      scannedPackageCount: 1,
      restoredPackageCount: 1,
      copiedFileCount: 2,
      unresolved: []
    });
    expect(readFileSync(join(target, 'LICENSE'), 'utf8')).toBe('React MIT license');
    expect(readFileSync(join(pnpmPackage, 'LICENSE'), 'utf8')).toBe('React MIT license');
    expect(restoreStandaloneLicenses(source, artifact).copiedFileCount).toBe(0);
  });

  it('reports packages without a same-version source notice', () => {
    const { source, artifact } = fixture();
    addPackage(source, 'onnxruntime-node', '1.30.0');
    addPackage(artifact, 'onnxruntime-node', '1.30.0');
    expect(restoreStandaloneLicenses(source, artifact).unresolved).toEqual([
      { package: 'onnxruntime-node@1.30.0', reason: 'no notice in exact-version source install' }
    ]);
  });

  it('rejects mismatched license metadata for the same package version', () => {
    const { source, artifact } = fixture();
    addPackage(source, 'react', '19.2.4', 'React MIT license');
    const target = addPackage(artifact, 'react', '19.2.4');
    writeFileSync(
      join(target, 'package.json'),
      JSON.stringify({ name: 'react', version: '19.2.4', license: 'Apache-2.0' })
    );
    expect(() => restoreStandaloneLicenses(source, artifact)).toThrow(/metadata differs/);
  });

  it('rejects changed text and a symlink notice destination', () => {
    const { source, artifact } = fixture();
    addPackage(source, 'next', '16.3.5', 'Original license');
    const target = addPackage(artifact, 'next', '16.3.5', 'Changed license');
    expect(() => restoreStandaloneLicenses(source, artifact)).toThrow(/differs/);
    rmSync(join(target, 'LICENSE'));
    writeFileSync(join(artifact, 'other-text'), 'Original license');
    symlinkSync(join(artifact, 'other-text'), join(target, 'LICENSE'));
    expect(() => restoreStandaloneLicenses(source, artifact)).toThrow(/not a regular file/);
  });

  it('restores exact-parent vendored notices without inventing child versions', () => {
    const { source, artifact, target } = vendoredFixture({
      notice: 'Exact original component notice'
    });
    const report = restoreStandaloneLicenses(source, artifact);
    expect(report).toMatchObject({
      copiedFileCount: 2,
      restoredPackageCount: 1,
      restoredVendoredComponentCount: 1,
      unresolved: []
    });
    expect(report.vendoredComponents).toHaveLength(1);
    expect(report.vendoredComponents[0]).toMatchObject({
      parentPackage: 'next@16.3.5',
      unresolved: null
    });
    expect(report.vendoredComponents[0].verifiedFiles).toHaveLength(2);
    expect(report.vendoredComponents[0].notices[0].filename).toBe('LICENSE');
    expect(report.vendoredComponents[0]).not.toHaveProperty('version');
    expect(readFileSync(join(target, 'LICENSE'), 'utf8')).toBe('Exact original component notice');
    const again = restoreStandaloneLicenses(source, artifact);
    expect(again.copiedFileCount).toBe(0);
    expect(again.restoredVendoredComponentCount).toBe(0);
  });

  it('restores a traced component even when tracing omitted its package metadata', () => {
    const { source, artifact, target } = vendoredFixture({
      metadata: false,
      notice: 'Original metadata-free component notice'
    });
    const report = restoreStandaloneLicenses(source, artifact);
    expect(report.restoredVendoredComponentCount).toBe(1);
    expect(report.vendoredComponents[0].verifiedFiles).toHaveLength(1);
    expect(readFileSync(join(target, 'LICENSE'), 'utf8')).toBe(
      'Original metadata-free component notice'
    );
  });

  it('keeps a missing vendored source notice explicit instead of substituting the Next license', () => {
    const { source, artifact, target } = vendoredFixture();
    const report = restoreStandaloneLicenses(source, artifact);
    expect(report.restoredVendoredComponentCount).toBe(0);
    expect(report.vendoredComponents[0]).toMatchObject({
      notices: [],
      unresolved: 'no notice in exact-version vendored source'
    });
    expect(existsSync(join(target, 'LICENSE'))).toBe(false);
  });

  it('rejects altered traced code before copying even top-level notices', () => {
    const { source, artifact, next, target } = vendoredFixture({ notice: 'Original notice' });
    writeFileSync(join(target, 'cjs/index.js'), 'changed traced code');
    expect(() => restoreStandaloneLicenses(source, artifact)).toThrow(/bytes differ/);
    expect(existsSync(join(next, 'LICENSE'))).toBe(false);
    expect(existsSync(join(target, 'LICENSE'))).toBe(false);
  });

  it('rejects altered vendored metadata and conflicting existing notice text before writes', () => {
    const first = vendoredFixture({ notice: 'Original notice' });
    writeFileSync(
      join(first.target, 'package.json'),
      JSON.stringify({ name: 'fixture-component', license: 'Apache-2.0' })
    );
    expect(() => restoreStandaloneLicenses(first.source, first.artifact)).toThrow(/bytes differ/);
    expect(existsSync(join(first.next, 'LICENSE'))).toBe(false);
    const second = vendoredFixture({ notice: 'Original notice' });
    writeFileSync(join(second.target, 'LICENSE'), 'Different copyright text');
    expect(() => restoreStandaloneLicenses(second.source, second.artifact)).toThrow(/differs/);
    expect(existsSync(join(second.next, 'LICENSE'))).toBe(false);
  });

  it('rejects a symlinked vendored component or source code file', () => {
    const first = vendoredFixture({ notice: 'Original notice' });
    const moved = join(first.artifact, 'component-alias');
    mkdirSync(moved);
    rmSync(first.target, { recursive: true });
    symlinkSync(moved, first.target);
    expect(() => restoreStandaloneLicenses(first.source, first.artifact)).toThrow(/symlink/);
    expect(existsSync(join(first.next, 'LICENSE'))).toBe(false);
    const second = vendoredFixture({ notice: 'Original notice' });
    const originalCode = join(second.original, 'cjs/index.js');
    rmSync(originalCode);
    symlinkSync(join(second.target, 'cjs/index.js'), originalCode);
    expect(() => restoreStandaloneLicenses(second.source, second.artifact)).toThrow(/symlink/);
    expect(existsSync(join(second.next, 'LICENSE'))).toBe(false);
  });

  it('rejects symlinked source or destination vendored notices', () => {
    for (const role of ['source', 'target'] as const) {
      const item = vendoredFixture({ notice: 'Original notice' });
      const link = join(role === 'source' ? item.original : item.target, 'LICENSE');
      if (role === 'source') rmSync(link);
      const sibling = join(item.artifact, 'notice-target');
      writeFileSync(sibling, 'Original notice');
      symlinkSync(sibling, link);
      expect(() => restoreStandaloneLicenses(item.source, item.artifact)).toThrow(
        role === 'source' ? /regular file/ : /vendored destination must not be a symlink/
      );
      expect(existsSync(join(item.next, 'LICENSE'))).toBe(false);
    }
  });

  it('does not bind a different parent version to otherwise matching vendored code', () => {
    const { source, artifact, next, target } = vendoredFixture({ notice: 'Original notice' });
    writeFileSync(
      join(next, 'package.json'),
      JSON.stringify({ name: 'next', version: '16.3.6', license: 'MIT' })
    );
    const report = restoreStandaloneLicenses(source, artifact);
    expect(report.unresolved).toEqual([
      { package: 'next@16.3.6', reason: 'no notice in exact-version source install' }
    ]);
    expect(report.copiedFileCount).toBe(0);
    expect(existsSync(join(target, 'LICENSE'))).toBe(false);
  });

  it('restores the original notice for actual installed Next vendored bytes without executing them', () => {
    const { source, artifact } = fixture();
    const installed = resolve('node_modules/next');
    const parentMetadata = readFileSync(join(installed, 'package.json'));
    const sourceNext = addPackage(source, 'next', '16.3.5', 'Original root fixture notice');
    const targetNext = addPackage(artifact, 'next', '16.3.5');
    writeFileSync(join(sourceNext, 'package.json'), parentMetadata);
    writeFileSync(join(targetNext, 'package.json'), parentMetadata);
    for (const root of [sourceNext, targetNext]) {
      const folder = join(root, 'dist/compiled/async-retry');
      mkdirSync(folder, { recursive: true });
      for (const name of ['package.json', 'index.js'])
        copyFileSync(join(installed, 'dist/compiled/async-retry', name), join(folder, name));
    }
    copyFileSync(
      join(installed, 'dist/compiled/async-retry/LICENSE'),
      join(sourceNext, 'dist/compiled/async-retry/LICENSE')
    );
    const report = restoreStandaloneLicenses(source, artifact);
    expect(report.restoredVendoredComponentCount).toBe(1);
    expect(readFileSync(join(targetNext, 'dist/compiled/async-retry/LICENSE'))).toEqual(
      readFileSync(join(installed, 'dist/compiled/async-retry/LICENSE'))
    );
  });

  it('restores an actual scoped vendored package without treating its namespace as one package', () => {
    const { source, artifact } = fixture();
    const installed = resolve('node_modules/next');
    const metadata = readFileSync(join(installed, 'package.json'));
    const sourceNext = addPackage(source, 'next', '16.3.5', 'Original root fixture notice');
    const targetNext = addPackage(artifact, 'next', '16.3.5');
    for (const root of [sourceNext, targetNext]) {
      writeFileSync(join(root, 'package.json'), metadata);
      const folder = join(root, 'dist/compiled/@hapi/accept');
      mkdirSync(folder, { recursive: true });
      for (const name of ['package.json', 'index.js'])
        copyFileSync(join(installed, 'dist/compiled/@hapi/accept', name), join(folder, name));
    }
    copyFileSync(
      join(installed, 'dist/compiled/@hapi/accept/LICENSE'),
      join(sourceNext, 'dist/compiled/@hapi/accept/LICENSE')
    );
    const unused = join(sourceNext, 'dist/compiled/@hapi/not-traced');
    mkdirSync(unused);
    writeFileSync(join(unused, 'LICENSE'), 'Unshipped sibling notice');
    const result = restoreStandaloneLicenses(source, artifact);
    expect(result.vendoredComponents).toHaveLength(1);
    expect(result.vendoredComponents[0]).toMatchObject({
      location: 'node_modules/next/dist/compiled/@hapi/accept',
      unresolved: null,
      notices: [expect.objectContaining({ path: 'LICENSE' })]
    });
    expect(readFileSync(join(targetNext, 'dist/compiled/@hapi/accept/LICENSE'))).toEqual(
      readFileSync(join(installed, 'dist/compiled/@hapi/accept/LICENSE'))
    );
    expect(existsSync(join(targetNext, 'dist/compiled/@hapi/LICENSE'))).toBe(false);
    expect(existsSync(join(targetNext, 'dist/compiled/@hapi/not-traced'))).toBe(false);
    expect(restoreStandaloneLicenses(source, artifact).copiedFileCount).toBe(0);
  });

  it('retains nested notices at their original relative paths, only for traced payload directories', () => {
    const item = vendoredFixture({ notice: 'Component notice' });
    writeFileSync(join(item.original, 'cjs/NOTICE'), 'Nested component attribution');
    mkdirSync(join(item.original, 'untraced'));
    writeFileSync(join(item.original, 'untraced/LICENSE'), 'Untraced notice');
    const result = restoreStandaloneLicenses(item.source, item.artifact);
    expect(
      result.vendoredComponents[0].notices.map((notice: { path: string }) => notice.path).toSorted()
    ).toEqual(['LICENSE', 'cjs/NOTICE']);
    expect(readFileSync(join(item.target, 'cjs/NOTICE'), 'utf8')).toBe(
      'Nested component attribution'
    );
    expect(existsSync(join(item.target, 'untraced'))).toBe(false);
  });

  it('rejects conflicting nested notice text before copying root notices', () => {
    const item = vendoredFixture({ notice: 'Component notice' });
    writeFileSync(join(item.original, 'cjs/NOTICE'), 'Original nested attribution');
    writeFileSync(join(item.target, 'cjs/NOTICE'), 'Conflicting nested attribution');
    expect(() => restoreStandaloneLicenses(item.source, item.artifact)).toThrow(/differs/);
    expect(existsSync(join(item.next, 'LICENSE'))).toBe(false);
    expect(existsSync(join(item.target, 'LICENSE'))).toBe(false);
  });

  it('rejects a symlinked source namespace before copying notices', () => {
    const { source, artifact } = fixture();
    const sourceNext = addPackage(source, 'next', '16.3.5', 'Root notice');
    const targetNext = addPackage(artifact, 'next', '16.3.5');
    const realScope = join(sourceNext, 'dist/compiled/real-scope');
    const sourceChild = join(realScope, 'child');
    const targetChild = join(targetNext, 'dist/compiled/@scope/child');
    for (const folder of [sourceChild, targetChild]) {
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'index.js'), 'module.exports = 1;');
    }
    writeFileSync(join(sourceChild, 'LICENSE'), 'Scoped notice');
    symlinkSync(realScope, join(sourceNext, 'dist/compiled/@scope'));
    expect(() => restoreStandaloneLicenses(source, artifact)).toThrow(/symlink/);
    expect(existsSync(join(targetNext, 'LICENSE'))).toBe(false);
    expect(existsSync(join(targetChild, 'LICENSE'))).toBe(false);
  });
});
