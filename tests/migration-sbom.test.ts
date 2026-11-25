import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBom, captureSourceSnapshot, sbomTarget } from '../scripts/generate-sbom.mjs';

const roots: string[] = [];
const generator = resolve('scripts/generate-sbom.mjs');
const verifier = resolve('scripts/verify-build-evidence.mjs');
const imageId = `sha256:${'a'.repeat(64)}`;
const tree = {
  name: 'worldloom-migrate-runtime',
  version: '1.0.0',
  dependencies: {
    prisma: { version: '6.19.3', dependencies: { 'deepmerge-ts': { version: '7.1.5' } } }
  }
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'migration-sbom-'));
  roots.push(root);
  mkdirSync(join(root, 'docker/migrate'), { recursive: true });
  mkdirSync(join(root, 'artifacts/bin'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), '/artifacts/\n');
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'worldloom', version: '0.1.0' })
  );
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'application lock fixture\n');
  writeFileSync(
    join(root, 'docker/migrate/package.json'),
    JSON.stringify({ name: tree.name, version: tree.version })
  );
  writeFileSync(join(root, 'docker/migrate/pnpm-lock.yaml'), 'migration lock fixture\n');
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'fixture'
    ]
  ]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  const snapshot = captureSourceSnapshot(root);
  const sbom = buildBom(tree, {
    snapshot,
    lockfile: readFileSync(join(root, 'docker/migrate/pnpm-lock.yaml')),
    artifactRole: 'migration'
  });
  const image = {
    Id: imageId,
    Config: {
      Labels: {
        'org.opencontainers.image.title': 'WorldLoom Migration',
        'org.opencontainers.image.revision': snapshot.revision
      }
    }
  };
  const inventory = {
    imageId,
    packageCount: 2,
    packages: [
      { name: 'prisma', version: '6.19.3' },
      { name: 'deepmerge-ts', version: '7.1.5' }
    ]
  };
  return { root, snapshot, sbom, image, inventory };
}

type Fixture = ReturnType<typeof fixture>;
function verify(f: Fixture, includeInventory = true) {
  for (const [name, value] of Object.entries({
    sbom: f.sbom,
    image: f.image,
    inventory: f.inventory
  })) {
    writeFileSync(join(f.root, 'artifacts', name + '.json'), JSON.stringify(value));
  }
  return spawnSync(
    process.execPath,
    [
      verifier,
      '--role',
      'migration',
      '--revision',
      f.snapshot.revision,
      '--sbom',
      'artifacts/sbom.json',
      '--image',
      'artifacts/image.json',
      '--output',
      'artifacts/index.json',
      ...(includeInventory ? ['--runtime-inventory', 'artifacts/inventory.json'] : [])
    ],
    { cwd: f.root, encoding: 'utf8' }
  );
}
function property(f: Fixture, name: string, value: string) {
  f.sbom.metadata.component.properties.find((p: { name: string }) => p.name === name)!.value =
    value;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('migration SBOM and image correlation', () => {
  it('uses the dedicated lock graph without application fonts or a package installation', () => {
    const f = fixture();
    const fakePnpm = join(f.root, 'artifacts/bin/pnpm');
    writeFileSync(
      fakePnpm,
      `#!${process.execPath}\nconst fs = require('node:fs'); fs.writeFileSync('artifacts/pnpm-args.json', JSON.stringify(process.argv.slice(2))); console.log(${JSON.stringify(JSON.stringify([tree]))});\n`
    );
    chmodSync(fakePnpm, 0o755);
    const result = spawnSync(process.execPath, [generator, '--role', 'migration', '--release'], {
      cwd: f.root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_SHA: f.snapshot.revision,
        PATH: join(f.root, 'artifacts/bin') + ':' + process.env.PATH
      }
    });
    expect(result.status, result.stderr).toBe(0);
    const document = JSON.parse(
      readFileSync(join(f.root, 'artifacts/worldloom-migrate-sbom.cdx.json'), 'utf8')
    );
    expect(document.components.map((c: { name: string }) => c.name).toSorted()).toEqual([
      'deepmerge-ts',
      'prisma'
    ]);
    expect(document.dependencies).toContainEqual({
      ref: 'pkg:npm/prisma@6.19.3',
      dependsOn: ['pkg:npm/deepmerge-ts@7.1.5']
    });
    expect(JSON.parse(readFileSync(join(f.root, 'artifacts/pnpm-args.json'), 'utf8'))).toEqual([
      '--dir',
      'docker/migrate',
      'list',
      '--prod',
      '--depth',
      'Infinity',
      '--json',
      '--lockfile-only'
    ]);
    expect(document.metadata.component.properties).toContainEqual({
      name: 'worldloom:lockfile-path',
      value: 'docker/migrate/pnpm-lock.yaml'
    });
    expect(captureSourceSnapshot(f.root)).toEqual(f.snapshot);
  });

  it('correlates a clean migration snapshot and the exact inventory without requiring UI fonts', () => {
    const f = fixture();
    const result = verify(f);
    expect(result.status, result.stderr).toBe(0);
    const index = JSON.parse(readFileSync(join(f.root, 'artifacts/index.json'), 'utf8'));
    expect(index.artifactRole).toBe('migration');
    expect(index.sbom.lockfilePath).toBe('docker/migrate/pnpm-lock.yaml');
    expect(index.runtimePackages).toMatchObject({
      status: 'PASS',
      imageId,
      sourceOnlyPackageCount: 0
    });
  });

  it.each([
    ['worldloom:artifact-role', 'application', 'artifact role or lockfile path'],
    ['worldloom:lockfile-path', 'pnpm-lock.yaml', 'artifact role or lockfile path'],
    [
      'worldloom:pnpm-lock-sha256',
      createHash('sha256').update('application lock fixture\n').digest('hex'),
      'lockfile digest mismatch'
    ],
    ['worldloom:source-revision', 'b'.repeat(40), 'source revision mismatch'],
    ['worldloom:source-worktree-state', 'dirty', 'clean source checkout']
  ])('rejects incorrect %s', (name, value, message) => {
    const f = fixture();
    property(f, name, value);
    const result = verify(f);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it('requires an image-bound inventory and refuses another image or revision', () => {
    const f = fixture();
    expect(verify(f, false).stderr).toContain('requires runtime inventory');
    f.inventory.imageId = `sha256:${'b'.repeat(64)}`;
    expect(verify(f).stderr).toContain('inventory image identity mismatch');
    f.inventory.imageId = imageId;
    f.image.Config.Labels['org.opencontainers.image.revision'] = 'b'.repeat(40);
    expect(verify(f).stderr).toContain('image revision mismatch');
    f.image.Config.Labels['org.opencontainers.image.revision'] = f.snapshot.revision;
    f.image.Config.Labels['org.opencontainers.image.title'] = 'WorldLoom';
    expect(verify(f).stderr).toContain('image title does not match');
  });

  it('refuses a mismatched dependency version and an incomplete runtime set', () => {
    const f = fixture();
    f.inventory.packages[1].version = '7.1.6';
    expect(verify(f).stderr).toContain('runtime package missing from source SBOM');
    f.inventory.packages.pop();
    f.inventory.packageCount = 1;
    expect(verify(f).stderr).toContain('migration SBOM and runtime package sets differ');
  });

  it('rejects the application root, unexpected file components and unsupported roles', () => {
    const f = fixture();
    f.sbom.metadata.component.name = 'worldloom';
    expect(verify(f).stderr).toContain('wrong root or non-npm');
    f.sbom.metadata.component.name = tree.name;
    f.sbom.components[0].type = 'file';
    expect(verify(f).stderr).toContain('wrong root or non-npm');
    expect(() => sbomTarget('worker')).toThrow('unsupported SBOM role');
  });
});
