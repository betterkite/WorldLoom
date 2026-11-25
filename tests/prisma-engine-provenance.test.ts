import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { inventoryRuntimePackages } from '../scripts/runtime-license-audit.mjs';
import { stagePrismaEngineProvenance } from '../scripts/stage-prisma-engine-provenance.mjs';

const roots: string[] = [];
const engineName = 'libquery_engine-linux-arm64-openssl-3.0.x.so.node';
const licenseSource = resolve(
  process.cwd(),
  'node_modules/.pnpm/@prisma+engines@6.19.3/node_modules/@prisma/engines/LICENSE'
);

function fixture(engineFilename = engineName) {
  const buildRoot = mkdtempSync(join(tmpdir(), 'worldloom-prisma-build-'));
  const artifactRoot = mkdtempSync(join(tmpdir(), 'worldloom-prisma-artifact-'));
  roots.push(buildRoot, artifactRoot);
  const source = join(
    buildRoot,
    'node_modules/.pnpm/@prisma+engines@6.19.3/node_modules/@prisma/engines'
  );
  const generated = join(
    artifactRoot,
    'node_modules/.pnpm/@prisma+client@6.19.3_test/node_modules/.prisma/client'
  );
  mkdirSync(source, { recursive: true });
  mkdirSync(generated, { recursive: true });
  writeFileSync(
    join(source, 'package.json'),
    JSON.stringify({ name: '@prisma/engines', version: '6.19.3', license: 'Apache-2.0' })
  );
  writeFileSync(join(generated, 'package.json'), JSON.stringify({ version: '6.19.3' }));
  copyFileSync(licenseSource, join(source, 'LICENSE'));
  writeFileSync(join(source, engineFilename), 'version-matched native engine');
  writeFileSync(join(generated, engineFilename), 'version-matched native engine');
  return { buildRoot, artifactRoot, source, generated };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Prisma native engine provenance', () => {
  it('binds exact source bytes and Apache text to the shipped generated client', () => {
    const { buildRoot, artifactRoot, generated } = fixture();
    const manifest = stagePrismaEngineProvenance(buildRoot, artifactRoot);
    expect(manifest.sourcePackage).toBe('@prisma/engines');
    expect(manifest.sourceVersion).toBe('6.19.3');
    expect(readFileSync(join(generated, 'LICENSE.prisma-engines'))).toEqual(
      readFileSync(licenseSource)
    );
    const report = inventoryRuntimePackages(artifactRoot);
    expect(report.nativeFileCount).toBe(1);
    expect(report.unattributedNativeFiles).toEqual([]);
    expect(report.declaredNativeProvenance).toMatchObject([
      { sourcePackage: '@prisma/engines@6.19.3' }
    ]);
    const strict = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'scripts/runtime-license-audit.mjs'), artifactRoot, '--strict'],
      { encoding: 'utf8' }
    );
    expect(strict.status, strict.stderr).toBe(0);
  });

  it('accepts the Debian/OpenSSL filename used by Linux/x64 Prisma', () => {
    const { buildRoot, artifactRoot } = fixture('libquery_engine-debian-openssl-3.0.x.so.node');
    const manifest = stagePrismaEngineProvenance(buildRoot, artifactRoot);
    expect(manifest.enginePath).toContain('libquery_engine-debian-openssl-3.0.x.so.node');
    const report = inventoryRuntimePackages(artifactRoot);
    expect(report.unattributedNativeFiles).toEqual([]);
    expect(report.declaredNativeProvenance).toHaveLength(1);
  });

  it('rejects a changed generated engine during staging', () => {
    const { buildRoot, artifactRoot, generated } = fixture();
    writeFileSync(join(generated, engineName), 'unrelated native engine');
    expect(() => stagePrismaEngineProvenance(buildRoot, artifactRoot)).toThrow('differs');
  });

  it('rejects tampering after staging', () => {
    const { buildRoot, artifactRoot, generated } = fixture();
    stagePrismaEngineProvenance(buildRoot, artifactRoot);
    writeFileSync(join(generated, engineName), 'tampered native engine');
    expect(() => inventoryRuntimePackages(artifactRoot)).toThrow('digest mismatch');
  });

  it('rejects a stale source package version', () => {
    const { buildRoot, artifactRoot, source } = fixture();
    writeFileSync(
      join(source, 'package.json'),
      JSON.stringify({ name: '@prisma/engines', version: '6.19.4', license: 'Apache-2.0' })
    );
    expect(() => stagePrismaEngineProvenance(buildRoot, artifactRoot)).toThrow('identity');
  });
});
