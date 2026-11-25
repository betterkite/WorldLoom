import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { inventoryRuntimePackages } from '../scripts/runtime-license-audit.mjs';

const temporaryRoots: string[] = [];
const script = resolve(process.cwd(), 'scripts/runtime-license-audit.mjs');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function root() {
  const directory = mkdtempSync(join(tmpdir(), 'worldloom-runtime-licenses-'));
  temporaryRoots.push(directory);
  mkdirSync(join(directory, 'node_modules'));
  return directory;
}

function packageAt(directory: string, name: string, version: string, withLicense = false) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version, license: 'MIT' }));
  if (withLicense) writeFileSync(join(directory, 'LICENSE'), 'MIT License\nCopyright (c) Example');
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('runtime license inventory', () => {
  it('includes nested scoped dependencies and terminates on a dependency-directory cycle', () => {
    const directory = root();
    const parent = join(directory, 'node_modules/tool');
    packageAt(parent, 'tool', '1.0.0', true);
    const nested = join(parent, 'node_modules/@scope/child');
    packageAt(nested, '@scope/child', '2.0.0');
    symlinkSync(join(directory, 'node_modules'), join(nested, 'node_modules'));
    const report = inventoryRuntimePackages(directory, { scanNativeFiles: false });
    expect(report.packageCount).toBe(2);
    expect(report.missingNoticeCount).toBe(1);
    expect(report.packages.find((entry) => entry.name === '@scope/child')?.version).toBe('2.0.0');
    const result = spawnSync(process.execPath, [script, directory, '--strict'], {
      encoding: 'utf8'
    });
    expect(result.status).toBe(1);
  });

  it('rejects an escaping nested dependency directory', () => {
    const directory = root();
    const outside = root();
    packageAt(join(directory, 'node_modules/tool'), 'tool', '1.0.0', true);
    packageAt(join(outside, 'node_modules/child'), 'child', '2.0.0', true);
    symlinkSync(join(outside, 'node_modules'), join(directory, 'node_modules/tool/node_modules'));
    expect(() => inventoryRuntimePackages(directory, { scanNativeFiles: false })).toThrow(
      'outside the application root'
    );
  });

  it('includes hidden pnpm packages and deduplicates top-level links', () => {
    const directory = root();
    packageAt(join(directory, 'node_modules', 'next'), 'next', '16.3.5');
    const pnpmReact = join(
      directory,
      'node_modules',
      '.pnpm',
      'react@19.2.4',
      'node_modules',
      'react'
    );
    packageAt(pnpmReact, 'react', '19.2.4', true);
    writeFileSync(join(pnpmReact, 'react-native.node'), 'native fixture');
    const prismaEngine = join(
      directory,
      'node_modules',
      '.pnpm',
      'prisma@6.19.3',
      'node_modules',
      '.prisma'
    );
    mkdirSync(prismaEngine, { recursive: true });
    writeFileSync(join(prismaEngine, 'libquery_engine.so.node'), 'engine');
    const schemaEngine = join(prismaEngine, 'schema-engine-linux-arm64-openssl-3.0.x');
    writeFileSync(schemaEngine, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    chmodSync(schemaEngine, 0o755);
    symlinkSync(pnpmReact, join(directory, 'node_modules', 'react'));
    packageAt(
      join(
        directory,
        'node_modules',
        '.pnpm',
        '@img+sharp-libvips-linux-arm64@1.3.3',
        'node_modules',
        '@img',
        'sharp-libvips-linux-arm64'
      ),
      '@img/sharp-libvips-linux-arm64',
      '1.3.3'
    );
    writeFileSync(
      join(
        directory,
        'node_modules/.pnpm/@img+sharp-libvips-linux-arm64@1.3.3/node_modules/@img/sharp-libvips-linux-arm64/versions.json'
      ),
      JSON.stringify({ vips: '8.18.6', glib: '2.89.4' })
    );

    const report = inventoryRuntimePackages(directory);
    expect(report.packageCount).toBe(3);
    expect(report.missingNoticeCount).toBe(2);
    expect(report.packages.find((entry) => entry.name === 'react')?.locations).toHaveLength(2);
    expect(report.packages.find((entry) => entry.name === 'react')?.nativeFiles).toEqual([
      { path: 'node_modules/.pnpm/react@19.2.4/node_modules/react/react-native.node', size: 14 }
    ]);
    expect(report.nativeFileCount).toBe(3);
    expect(report.unattributedNativeFiles).toEqual([
      {
        path: 'node_modules/.pnpm/prisma@6.19.3/node_modules/.prisma/libquery_engine.so.node',
        size: 6
      },
      {
        path: 'node_modules/.pnpm/prisma@6.19.3/node_modules/.prisma/schema-engine-linux-arm64-openssl-3.0.x',
        size: 4
      }
    ]);
    expect(
      report.packages.find((entry) => entry.name === '@img/sharp-libvips-linux-arm64')
    ).toMatchObject({ noticeFiles: [] });
  });

  it('records exact notice and native bytes without treating version declarations as binary proof', () => {
    const directory = root();
    const sharp = join(directory, 'node_modules/@img/sharp-libvips-linux-arm64');
    packageAt(sharp, '@img/sharp-libvips-linux-arm64', '1.3.3', true);
    writeFileSync(join(sharp, 'versions.json'), JSON.stringify({ vips: '8.18.6' }));
    writeFileSync(join(sharp, 'libvips.so'), 'binary fixture');
    const first = inventoryRuntimePackages(directory);
    expect(first.noticeDigests).toEqual([
      {
        path: 'node_modules/@img/sharp-libvips-linux-arm64/LICENSE',
        sha256: hash('MIT License\nCopyright (c) Example')
      }
    ]);
    expect(first.nativeFileDigests).toEqual([
      {
        path: 'node_modules/@img/sharp-libvips-linux-arm64/libvips.so',
        sha256: hash('binary fixture')
      }
    ]);
    expect(first.bundledComponentVersionDeclarations).toEqual([
      {
        package: '@img/sharp-libvips-linux-arm64@1.3.3',
        path: 'node_modules/@img/sharp-libvips-linux-arm64/versions.json',
        sha256: hash(JSON.stringify({ vips: '8.18.6' })),
        versions: { vips: '8.18.6' }
      }
    ]);
    writeFileSync(join(sharp, 'LICENSE'), 'changed text');
    writeFileSync(join(sharp, 'libvips.so'), 'different bytes');
    const second = inventoryRuntimePackages(directory);
    expect(second.noticeDigests).not.toEqual(first.noticeDigests);
    expect(second.nativeFileDigests).not.toEqual(first.nativeFileDigests);
  });

  it('rejects malformed component declarations and paths escaping the payload', () => {
    const directory = root();
    const sharp = join(directory, 'node_modules/@img/sharp-libvips-linux-arm64');
    packageAt(sharp, '@img/sharp-libvips-linux-arm64', '1.3.3', true);
    writeFileSync(join(sharp, 'versions.json'), JSON.stringify({ vips: null }));
    expect(() => inventoryRuntimePackages(directory)).toThrow('declaration is invalid');
    rmSync(join(sharp, 'versions.json'));
    const outside = root();
    writeFileSync(join(outside, 'versions.json'), JSON.stringify({ vips: '8.18.6' }));
    symlinkSync(join(outside, 'versions.json'), join(sharp, 'versions.json'));
    expect(() => inventoryRuntimePackages(directory)).toThrow('outside the application root');
  });

  it('fails strict mode when a runtime package has no notice', () => {
    const directory = root();
    packageAt(join(directory, 'node_modules', 'next'), 'next', '16.3.5');
    mkdirSync(join(directory, 'node_modules', 'next', 'LICENSE'));
    const result = spawnSync(process.execPath, [script, directory, '--strict'], {
      encoding: 'utf8'
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ packageCount: 1, missingNoticeCount: 1 });
  });

  it('passes strict mode when every package has a notice', () => {
    const directory = root();
    packageAt(join(directory, 'node_modules', 'next'), 'next', '16.3.5', true);
    const result = spawnSync(process.execPath, [script, directory, '--strict'], {
      encoding: 'utf8'
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ packageCount: 1, missingNoticeCount: 0 });
  });

  it('does not accept an empty notice file', () => {
    const directory = root();
    const packageDirectory = join(directory, 'node_modules', 'next');
    packageAt(packageDirectory, 'next', '16.3.5', true);
    writeFileSync(join(packageDirectory, 'LICENSE'), '');
    expect(inventoryRuntimePackages(directory).missingNoticeCount).toBe(1);
  });

  it('fails strict mode when package license metadata is absent', () => {
    const directory = root();
    const packageDirectory = join(directory, 'node_modules', 'next');
    packageAt(packageDirectory, 'next', '16.3.5', true);
    writeFileSync(
      join(packageDirectory, 'package.json'),
      JSON.stringify({ name: 'next', version: '16.3.5' })
    );
    const result = spawnSync(process.execPath, [script, directory, '--strict'], {
      encoding: 'utf8'
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      packageCount: 1,
      missingNoticeCount: 0,
      missingLicenseMetadataCount: 1
    });
  });

  it('fails strict mode for an unassigned native binary', () => {
    const directory = root();
    packageAt(join(directory, 'node_modules', 'next'), 'next', '16.3.5', true);
    mkdirSync(join(directory, 'node_modules', '.prisma'));
    writeFileSync(join(directory, 'node_modules', '.prisma', 'query-engine.so.node'), 'engine');
    const result = spawnSync(process.execPath, [script, directory, '--strict'], {
      encoding: 'utf8'
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      missingNoticeCount: 0,
      missingLicenseMetadataCount: 0,
      nativeFileCount: 1,
      unattributedNativeFiles: [{ path: 'node_modules/.prisma/query-engine.so.node', size: 6 }]
    });
  });
  it('records the supplied immutable image identity and rejects tag or missing values', () => {
    const directory = root();
    packageAt(join(directory, 'node_modules', 'next'), 'next', '16.3.5', true);
    const imageId = `sha256:${'a'.repeat(64)}`;
    const good = spawnSync(
      process.execPath,
      [script, directory, '--strict', '--image-id', imageId],
      { encoding: 'utf8' }
    );
    expect(good.status, good.stderr).toBe(0);
    expect(JSON.parse(good.stdout).imageId).toBe(imageId);
    for (const value of ['worldloom:ci', '']) {
      const bad = spawnSync(process.execPath, [script, directory, '--image-id', value], {
        encoding: 'utf8'
      });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain('expected an immutable image ID');
    }
  });
});
