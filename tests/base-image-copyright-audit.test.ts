import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  auditBaseImageCopyright,
  auditNodeRuntimeLicense
} from '../scripts/base-image-copyright-audit.mjs';

const roots: string[] = [];
const script = resolve(process.cwd(), 'scripts/base-image-copyright-audit.mjs');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'worldloom-base-copyright-'));
  roots.push(root);
  return root;
}

function copyright(root: string, name: string) {
  const directory = join(root, 'usr/share/doc', name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'copyright'), `Copyright: ${name}\nLicense: MIT\n`);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Debian base image copyright inventory', () => {
  const nodeLicense = readFileSync(
    resolve(process.cwd(), 'third_party/runtime-licenses/node-24.21.0.LICENSE')
  );

  it.each([
    ['/nodejs/bin/node', 'nodejs/LICENSE'],
    ['/usr/local/bin/node', 'usr/local/LICENSE']
  ])(
    'checks the full upstream Node notice for %s outside the Debian inventory',
    (executable, path) => {
      const root = fixture();
      const file = join(root, path);
      mkdirSync(resolve(file, '..'), { recursive: true });
      writeFileSync(file, nodeLicense);
      expect(auditNodeRuntimeLicense(root, { version: '24.21.0', executable })).toMatchObject({
        version: '24.21.0',
        licensePath: path,
        licenseSha256: '5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace'
      });
      writeFileSync(file, nodeLicense.subarray(0, 200));
      expect(() => auditNodeRuntimeLicense(root, { version: '24.21.0', executable })).toThrow(
        'digest mismatch'
      );
      rmSync(file);
      expect(() => auditNodeRuntimeLicense(root, { version: '24.21.0', executable })).toThrow(
        'missing'
      );
    }
  );

  it('rejects unreviewed Node versions, executable locations and escaping notices', () => {
    const root = fixture();
    expect(() =>
      auditNodeRuntimeLicense(root, { version: '24.22.0', executable: '/nodejs/bin/node' })
    ).toThrow('no reviewed license binding');
    expect(() =>
      auditNodeRuntimeLicense(root, { version: '24.21.0', executable: '/tmp/node' })
    ).toThrow('no reviewed license location');
    const outside = fixture();
    writeFileSync(join(outside, 'LICENSE'), nodeLicense);
    mkdirSync(join(root, 'nodejs'));
    symlinkSync(join(outside, 'LICENSE'), join(root, 'nodejs/LICENSE'));
    expect(() =>
      auditNodeRuntimeLicense(root, { version: '24.21.0', executable: '/nodejs/bin/node' })
    ).toThrow('escapes image root');
  });

  it('matches distroless status.d packages to exact copyright files', () => {
    const root = fixture();
    const directory = join(root, 'var/lib/dpkg/status.d');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'libc6'),
      'Package: libc6\nVersion: 2.41\nArchitecture: arm64\nSource: glibc\n'
    );
    writeFileSync(join(directory, 'libc6.md5sums'), 'ignored');
    copyright(root, 'libc6');
    const report = auditBaseImageCopyright(root);
    expect(report).toMatchObject({
      statusSource: 'status.d',
      packageCount: 1,
      missingCopyrightCount: 0
    });
    expect(report.packages[0]).toMatchObject({
      name: 'libc6',
      version: '2.41',
      sourcePackage: 'glibc'
    });
    expect(report.packages[0].copyrightSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects missing copyright in strict mode', () => {
    const root = fixture();
    const directory = join(root, 'var/lib/dpkg/status.d');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'libc6'), 'Package: libc6\nVersion: 2.41\n');
    const result = spawnSync(process.execPath, [script, root, '--strict'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ missingCopyrightCount: 1 });
  });

  it('reads installed packages from the Debian status file', () => {
    const root = fixture();
    const directory = join(root, 'var/lib/dpkg');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'status'),
      'Package: base-files\nStatus: install ok installed\nVersion: 13.8\n\n' +
        'Package: removed\nStatus: deinstall ok config-files\nVersion: 1\n\n'
    );
    copyright(root, 'base-files');
    expect(auditBaseImageCopyright(root)).toMatchObject({
      statusSource: 'status',
      packageCount: 1,
      missingCopyrightCount: 0
    });
  });

  it('rejects copyright symlinks that leave the image root', () => {
    const root = fixture();
    const outside = fixture();
    const directory = join(root, 'var/lib/dpkg/status.d');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'libc6'), 'Package: libc6\nVersion: 2.41\n');
    const doc = join(root, 'usr/share/doc/libc6');
    mkdirSync(doc, { recursive: true });
    const external = join(outside, 'copyright');
    writeFileSync(external, 'external license');
    symlinkSync(external, join(doc, 'copyright'));
    expect(() => auditBaseImageCopyright(root)).toThrow('escapes image root');
  });

  it('requires both production and migration base audits in CI', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    expect(workflow).toContain('artifacts/worldloom-migrate-base-copyright.json');
    expect(workflow).toContain('artifacts/worldloom-base-copyright.json');
    expect(
      workflow.match(/\/tmp\/base-image-copyright-audit\.mjs \/ --strict --node-runtime/g)
    ).toHaveLength(2);
  });
});
