import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBom, captureSourceSnapshot, packageUrl } from '../scripts/generate-sbom.mjs';
import { auditBundledFonts } from '../scripts/font-assets-audit.mjs';
import { reconcileRuntimePackages } from '../scripts/reconcile-runtime-sbom.mjs';

const temporaryRoots: string[] = [];
const generator = resolve('scripts/generate-sbom.mjs');
const verifier = resolve('scripts/verify-build-evidence.mjs');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'worldloom-sbom-'));
  temporaryRoots.push(root);
  function git(...args: string[]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  }
  git('init', '--quiet');
  writeFileSync(join(root, '.gitignore'), '/artifacts/\n.env*\n');
  writeFileSync(join(root, 'source.txt'), 'initial source\n');
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  cpSync(resolve('public/fonts'), join(root, 'public/fonts'), { recursive: true });
  git('add', '.');
  git(
    '-c',
    'user.name=WorldLoom Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'fixture'
  );
  return { root, git };
}

function bom(root: string) {
  return buildBom(
    {
      name: 'worldloom',
      version: '0.1.0-dev.0',
      dependencies: {
        '@scope/example': { version: '2.0.0', dependencies: { child: { version: '1.0.0' } } },
        child: { version: '1.0.0' }
      }
    },
    {
      lockfile: readFileSync(join(root, 'pnpm-lock.yaml')),
      snapshot: captureSourceSnapshot(root),
      fontManifest: auditBundledFonts(root).manifest
    }
  );
}

function verify(root: string, document = bom(root), signedDocument?: unknown, inventory?: unknown) {
  const artifactRoot = join(root, 'artifacts');
  mkdirSync(artifactRoot, { recursive: true });
  const revision = captureSourceSnapshot(root).revision;
  writeFileSync(join(artifactRoot, 'sbom.json'), JSON.stringify(document));
  const extraArgs: string[] = [];
  if (inventory !== undefined) {
    writeFileSync(join(artifactRoot, 'runtime.json'), JSON.stringify(inventory));
    extraArgs.push('--runtime-inventory', join(artifactRoot, 'runtime.json'));
  }
  if (signedDocument !== undefined) {
    const archive = Buffer.from('synthetic image archive; no real signature');
    writeFileSync(join(artifactRoot, 'image.tar'), archive);
    writeFileSync(
      join(artifactRoot, 'sbom-verification.json'),
      JSON.stringify([
        {
          verificationResult: {
            statement: {
              predicateType: 'https://cyclonedx.org/bom',
              subject: [{ digest: { sha256: createHash('sha256').update(archive).digest('hex') } }],
              predicate: signedDocument
            }
          }
        }
      ])
    );
    extraArgs.push(
      '--sbom-provenance',
      join(artifactRoot, 'sbom-verification.json'),
      '--provenance-artifact',
      join(artifactRoot, 'image.tar')
    );
  }
  writeFileSync(
    join(artifactRoot, 'image.json'),
    JSON.stringify({
      Id: `sha256:${'a'.repeat(64)}`,
      Config: {
        Labels: {
          'org.opencontainers.image.title': 'WorldLoom',
          'org.opencontainers.image.revision': revision
        }
      }
    })
  );
  return spawnSync(
    process.execPath,
    [
      verifier,
      '--revision',
      revision,
      '--sbom',
      join(artifactRoot, 'sbom.json'),
      '--image',
      join(artifactRoot, 'image.json'),
      '--output',
      join(artifactRoot, 'evidence.json'),
      ...extraArgs
    ],
    { cwd: root, encoding: 'utf8' }
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('SBOM source identity and release evidence', () => {
  it('uses installed local package identity and keeps its pnpm locator', () => {
    const root = mkdtempSync(join(tmpdir(), 'worldloom-local-bom-'));
    temporaryRoots.push(root);
    const metadata = { name: 'client-only', version: '0.0.1-worldloom.1', license: 'MIT' };
    writeFileSync(join(root, 'package.json'), JSON.stringify(metadata));
    const tree = {
      name: 'worldloom',
      version: '0.1.0',
      dependencies: { 'client-only': { version: 'file:packages/client-only', path: root } }
    };
    const options = {
      lockfile: Buffer.from('local fixture'),
      snapshot: { revision: 'fixture', worktreeState: 'dirty', sourceTreeSha256: 'fixture' }
    };
    const document = buildBom(tree, options);
    expect(document.components[0]).toMatchObject({
      name: 'client-only',
      version: '0.0.1-worldloom.1',
      purl: 'pkg:npm/client-only@0.0.1-worldloom.1',
      licenses: [{ license: { name: 'MIT' } }],
      properties: [{ name: 'worldloom:local-dependency', value: 'file:packages/client-only' }]
    });
    expect(document.dependencies[0].dependsOn).toContain('pkg:npm/client-only@0.0.1-worldloom.1');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ ...metadata, name: 'wrong-package' })
    );
    expect(() => buildBom(tree, options)).toThrow('Local dependency metadata');
    rmSync(join(root, 'package.json'));
    expect(() => buildBom(tree, options)).toThrow();
  });

  it('uses npm namespace separators and encodes scoped names and prerelease versions', () => {
    expect(packageUrl('@scope/example', '2.0.0')).toBe('pkg:npm/%40scope/example@2.0.0');
    expect(packageUrl('example', '0.1.0-dev.0+build')).toBe('pkg:npm/example@0.1.0-dev.0%2Bbuild');
  });

  it('emits unique RFC-4122 serial numbers and retains transitive dependency relationships', () => {
    const { root } = fixture();
    const first = bom(root);
    const second = bom(root);
    expect(first.serialNumber).toMatch(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(first.serialNumber).not.toBe(second.serialNumber);
    expect(first.components).toHaveLength(30);
    expect(first.dependencies).toContainEqual({
      ref: 'pkg:npm/%40scope/example@2.0.0',
      dependsOn: ['pkg:npm/child@1.0.0']
    });
  });

  it('hashes a clean source tree deterministically while excluding ignored credentials and generated artifacts', () => {
    const { root } = fixture();
    const before = captureSourceSnapshot(root);
    writeFileSync(join(root, '.env.local'), 'SYNTHETIC_SECRET=ignored');
    mkdirSync(join(root, 'artifacts'));
    writeFileSync(join(root, 'artifacts', 'report.json'), '{}');
    expect(captureSourceSnapshot(root)).toEqual(before);
    expect(before.worktreeState).toBe('clean');
  });

  it('detects source changes even when Git assume-unchanged hides them from status', () => {
    const { root, git } = fixture();
    const before = captureSourceSnapshot(root);
    git('update-index', '--assume-unchanged', 'source.txt');
    writeFileSync(join(root, 'source.txt'), 'changed bytes\n');
    expect(git('status', '--porcelain')).toBe('');
    const after = captureSourceSnapshot(root);
    expect(after.worktreeState).toBe('dirty');
    expect(after.sourceTreeSha256).not.toBe(before.sourceTreeSha256);
  });

  it('includes untracked source and deletions in the snapshot', () => {
    const { root, git } = fixture();
    const before = captureSourceSnapshot(root);
    writeFileSync(join(root, 'new-source.txt'), 'new source');
    git('rm', '--quiet', 'source.txt');
    const after = captureSourceSnapshot(root);
    expect(after.worktreeState).toBe('dirty');
    expect(after.fileCount).toBe(before.fileCount + 1);
    expect(after.sourceTreeSha256).not.toBe(before.sourceTreeSha256);
  });

  it('rejects an environment revision that differs from actual checkout HEAD', () => {
    const { root } = fixture();
    expect(() => captureSourceSnapshot(root, 'b'.repeat(40))).toThrow(
      'does not match checkout HEAD'
    );
  });

  it('blocks release generation from a dirty checkout before dependency enumeration', () => {
    const { root } = fixture();
    writeFileSync(join(root, 'source.txt'), 'changed');
    const result = spawnSync(process.execPath, [generator, '--release'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_SHA: '' }
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('requires a clean source checkout');
  });

  it('accepts a clean snapshot and carries its digest into the evidence index', () => {
    const { root } = fixture();
    const result = verify(root);
    expect(result.status, result.stderr).toBe(0);
    const evidence = JSON.parse(readFileSync(join(root, 'artifacts', 'evidence.json'), 'utf8'));
    expect(evidence.sourceTreeSha256).toBe(captureSourceSnapshot(root).sourceTreeSha256);
  });

  it('rejects local candidate SBOMs from release evidence correlation', () => {
    const { root } = fixture();
    writeFileSync(join(root, 'source.txt'), 'changed');
    const result = verify(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('requires an SBOM from a clean source checkout');
  });

  it('rejects a different or missing lockfile digest even when revision and image match', () => {
    const { root } = fixture();
    const document = bom(root);
    const property = document.metadata.component.properties.find(
      (value) => value.name === 'worldloom:pnpm-lock-sha256'
    )!;
    property.value = 'a'.repeat(64);
    expect(verify(root, document).stderr).toContain('SBOM lockfile digest mismatch');
    document.metadata.component.properties = document.metadata.component.properties.filter(
      (value) => value !== property
    );
    expect(verify(root, document).stderr).toContain('SBOM lockfile digest mismatch');
  });

  it('rejects another signed SBOM for the same archive and missing predicate contents', () => {
    const { root } = fixture();
    const document = bom(root);
    const substituted = structuredClone(document);
    substituted.components[0].version = '99.0.0';
    for (const predicate of [substituted, null]) {
      const result = verify(root, document, predicate);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('signed SBOM predicate does not match');
    }
  });

  it('accepts matching signed SBOM contents regardless of JSON object key order', () => {
    const { root } = fixture();
    const document = bom(root);
    const reordered = Object.fromEntries(Object.entries(document).toReversed());
    const result = verify(root, document, reordered);
    expect(result.status, result.stderr).toBe(0);
  });

  it('rejects old SBOMs without snapshot state and a source digest', () => {
    const { root } = fixture();
    const document = bom(root);
    document.metadata.component.properties = document.metadata.component.properties.filter(
      (item) => item.name === 'worldloom:source-revision'
    );
    const result = verify(root, document);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('requires an SBOM from a clean source checkout');
  });

  it('rejects malformed serial numbers and scoped Package URLs', () => {
    const { root } = fixture();
    const document = bom(root);
    document.serialNumber = `urn:uuid:${'a'.repeat(32)}`;
    expect(verify(root, document).stderr).toContain('serial number');
    document.serialNumber = bom(root).serialNumber;
    document.components[0].purl = 'pkg:npm/%40scope%2Fexample@2.0.0';
    expect(verify(root, document).stderr).toContain('invalid npm Package URL');
  });

  it('rejects missing font components or altered font license evidence', () => {
    const { root } = fixture();
    const missing = bom(root);
    missing.components = missing.components.filter((value) => value.type !== 'file');
    expect(verify(root, missing).stderr).toContain('font coverage is incomplete');
    const altered = bom(root);
    const font = altered.components.find((value) => value.type === 'file')!;
    font.properties.find(
      (value: { name: string; value: string }) => value.name === 'worldloom:font-license-sha256'
    )!.value = 'a'.repeat(64);
    expect(verify(root, altered).stderr).toContain('font source, bytes or license is invalid');
    const mislabeled = bom(root);
    const mislabeledFont = mislabeled.components.find((value) => value.type === 'file')!;
    mislabeledFont.properties.find(
      (value: { name: string; value: string }) => value.name === 'worldloom:font-family'
    )!.value = 'unreviewed family';
    expect(verify(root, mislabeled).stderr).toContain('font source, bytes or license is invalid');
  });
  it('correlates exact runtime versions while allowing source-only browser dependencies', () => {
    const { root } = fixture();
    const document = bom(root);
    const inventory = {
      imageId: `sha256:${'a'.repeat(64)}`,
      packageCount: 1,
      packages: [{ name: 'child', version: '1.0.0' }]
    };
    const result = verify(root, document, undefined, inventory);
    expect(result.status, result.stderr).toBe(0);
    const evidence = JSON.parse(readFileSync(join(root, 'artifacts/evidence.json'), 'utf8'));
    expect(evidence.runtimePackages).toMatchObject({
      status: 'PASS',
      packages: ['pkg:npm/child@1.0.0'],
      sourceOnlyPackageCount: 1,
      imageId: inventory.imageId,
      inventorySha256: createHash('sha256').update(JSON.stringify(inventory)).digest('hex')
    });
    inventory.packages[0].version = '2.0.0';
    expect(verify(root, document, undefined, inventory).stderr).toContain(
      'runtime package missing from source SBOM'
    );
  });

  it('rejects inventory from another image or without an image binding', () => {
    const { root } = fixture();
    const document = bom(root);
    for (const imageId of [`sha256:${'b'.repeat(64)}`, undefined]) {
      const result = verify(root, document, undefined, {
        imageId,
        packageCount: 1,
        packages: [{ name: 'child', version: '1.0.0' }]
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('runtime inventory image identity mismatch');
    }
    const result = verify(root, document);
    expect(result.status).toBe(0);
    expect(
      JSON.parse(readFileSync(join(root, 'artifacts/evidence.json'), 'utf8')).runtimePackages.status
    ).toBe('PENDING');
  });

  it('rejects empty, duplicate and inconsistent runtime inventories', () => {
    const { root } = fixture();
    const document = bom(root);
    const pkg = { name: 'child', version: '1.0.0' };
    for (const inventory of [
      { packageCount: 0, packages: [] },
      { packageCount: 2, packages: [pkg] },
      { packageCount: 2, packages: [pkg, pkg] },
      { packageCount: 1, packages: [{ name: 'child' }] }
    ])
      expect(() => reconcileRuntimePackages(document, inventory)).toThrow();
  });
});
