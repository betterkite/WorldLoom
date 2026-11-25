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

import { inventoryRuntimePackages } from '../scripts/runtime-license-audit.mjs';
import { stageVersionedRuntimeNotices } from '../scripts/stage-versioned-runtime-notices.mjs';

const source = resolve(process.cwd(), 'third_party/runtime-licenses');
const roots: string[] = [];
const sharpManifest = JSON.parse(
  readFileSync(join(source, 'sharp-components/manifest.json'), 'utf8')
);
const sharpVersions = sharpManifest.declaredComponents as Record<string, string>;

function packageDirectory(root: string, name: string, version: string, license = 'MIT') {
  const directory = join(root, 'node_modules', name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version, license }));
  return directory;
}

function runtimeRoot(arch = 'arm64') {
  const root = mkdtempSync(join(tmpdir(), 'worldloom-runtime-notices-'));
  roots.push(root);
  packageDirectory(root, '@next/env', '16.4.5');
  packageDirectory(root, 'onnxruntime-common', '1.30.0');
  packageDirectory(root, 'onnxruntime-node', '1.30.0');
  const sharp = packageDirectory(
    root,
    `@img/sharp-libvips-linux-${arch}`,
    '1.3.4',
    'LGPL-3.0-or-later'
  );
  writeFileSync(join(sharp, 'versions.json'), JSON.stringify(sharpVersions));
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('version-matched runtime notices', () => {
  it.each(['arm64', 'x64'])('stages unmodified upstream notices for Linux/%s', (arch) => {
    const root = runtimeRoot(arch);
    expect(stageVersionedRuntimeNotices(root, source).copiedFileCount).toBe(68);
    expect(stageVersionedRuntimeNotices(root, source).copiedFileCount).toBe(0);
    expect(inventoryRuntimePackages(root, { scanNativeFiles: false }).missingNoticeCount).toBe(0);
    expect(
      readFileSync(
        join(
          root,
          `node_modules/@img/sharp-libvips-linux-${arch}/NOTICE.worldloom-glib-2.90.0.LICENSES__LGPL-2.1-or-later.txt`
        )
      )
    ).toEqual(
      readFileSync(join(source, 'sharp-components/glib-2.90.0.LICENSES__LGPL-2.1-or-later.txt'))
    );
    expect(readFileSync(join(root, 'node_modules/@next/env/LICENSE.worldloom-upstream'))).toEqual(
      readFileSync(join(source, 'next-env-16.4.5.LICENSE'))
    );
    expect(
      readFileSync(join(root, 'node_modules/onnxruntime-node/NOTICE.worldloom-onnxruntime.txt'))
    ).toEqual(readFileSync(join(source, 'onnxruntime-1.30.0-ThirdPartyNotices.txt')));
    expect(
      readFileSync(
        join(
          root,
          `node_modules/@img/sharp-libvips-linux-${arch}/NOTICE.worldloom-sharp-libvips.md`
        )
      )
    ).toEqual(readFileSync(join(source, 'sharp-libvips-1.3.4-THIRD-PARTY-NOTICES.md')));
  });

  it.each(Object.keys(sharpVersions))(
    'rejects changed embedded %s versions before any copy',
    (component) => {
      const root = runtimeRoot();
      const path = join(root, 'node_modules/@img/sharp-libvips-linux-arm64/versions.json');
      const versions = JSON.parse(readFileSync(path, 'utf8'));
      versions[component] = 'unreviewed';
      writeFileSync(path, JSON.stringify(versions));
      expect(() => stageVersionedRuntimeNotices(root, source)).toThrow('component version changed');
      expect(existsSync(join(root, 'node_modules/@next/env/LICENSE.worldloom-upstream'))).toBe(
        false
      );
    }
  );

  it('rejects a symlink component declaration before copying notices', () => {
    const root = runtimeRoot();
    const path = join(root, 'node_modules/@img/sharp-libvips-linux-arm64/versions.json');
    copyFileSync(path, join(root, 'versions.json'));
    rmSync(path);
    symlinkSync(join(root, 'versions.json'), path);
    expect(() => stageVersionedRuntimeNotices(root, source)).toThrow('regular in-root file');
    expect(existsSync(join(root, 'node_modules/@next/env/LICENSE.worldloom-upstream'))).toBe(false);
  });

  it('rejects unknown Sharp/libvips versions without partially staging earlier packages', () => {
    const root = runtimeRoot();
    writeFileSync(
      join(root, 'node_modules/@img/sharp-libvips-linux-arm64/package.json'),
      JSON.stringify({
        name: '@img/sharp-libvips-linux-arm64',
        version: '0.0.0-unreviewed',
        license: 'LGPL-3.0-or-later'
      })
    );
    expect(() => stageVersionedRuntimeNotices(root, source)).toThrow('exact-version');
    expect(existsSync(join(root, 'node_modules/@next/env/LICENSE.worldloom-upstream'))).toBe(false);
  });

  it('rejects changed Sharp license metadata before writing any notices', () => {
    const root = runtimeRoot();
    writeFileSync(
      join(root, 'node_modules/@img/sharp-libvips-linux-arm64/package.json'),
      JSON.stringify({ name: '@img/sharp-libvips-linux-arm64', version: '1.3.4', license: 'MIT' })
    );
    expect(() => stageVersionedRuntimeNotices(root, source)).toThrow('license changed');
    expect(existsSync(join(root, 'node_modules/@next/env/LICENSE.worldloom-upstream'))).toBe(false);
  });

  it('rejects symlink notice destinations even when their content matches', () => {
    const root = runtimeRoot();
    copyFileSync(
      join(source, 'onnxruntime-1.30.0-ThirdPartyNotices.txt'),
      join(root, 'original-notice.txt')
    );
    symlinkSync(
      join(root, 'original-notice.txt'),
      join(root, 'node_modules/onnxruntime-node/NOTICE.worldloom-onnxruntime.txt')
    );
    expect(() => stageVersionedRuntimeNotices(root, source)).toThrow('not a regular file');
    expect(existsSync(join(root, 'node_modules/@next/env/LICENSE.worldloom-upstream'))).toBe(false);
  });

  it('fails closed when a package version changes', () => {
    const root = runtimeRoot();
    writeFileSync(
      join(root, 'node_modules/@next/env/package.json'),
      JSON.stringify({ name: '@next/env', version: '16.3.6', license: 'MIT' })
    );
    expect(() => stageVersionedRuntimeNotices(root, source)).toThrow('version or license changed');
  });

  it('rejects a source file that differs from its pinned digest', () => {
    const root = runtimeRoot();
    const alteredSource = mkdtempSync(join(tmpdir(), 'worldloom-altered-notices-'));
    roots.push(alteredSource);
    for (const filename of [
      'next-env-16.4.5.LICENSE',
      'onnxruntime-1.30.0.LICENSE',
      'onnxruntime-1.30.0-ThirdPartyNotices.txt',
      'sharp-libvips-1.3.4-THIRD-PARTY-NOTICES.md'
    ]) {
      copyFileSync(join(source, filename), join(alteredSource, filename));
    }
    writeFileSync(join(alteredSource, 'sharp-libvips-1.3.4-THIRD-PARTY-NOTICES.md'), 'wrong text');
    expect(() => stageVersionedRuntimeNotices(root, alteredSource)).toThrow('digest changed');
    expect(existsSync(join(root, 'node_modules/@next/env/LICENSE.worldloom-upstream'))).toBe(false);
  });
});
