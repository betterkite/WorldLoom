import {
  cpSync,
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
import { auditBundledFonts } from '../scripts/font-assets-audit.mjs';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'worldloom-font-fixture-'));
  roots.push(root);
  cpSync(resolve('public/fonts'), join(root, 'public/fonts'), { recursive: true });
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('bundled original font bytes and license payload', () => {
  it('covers all five original families, 28 subsets and five complete licenses', () => {
    const report = auditBundledFonts(fixture());
    expect(report).toMatchObject({
      fontFamilies: 5,
      fontFiles: 28,
      fontBytes: 541312,
      licenseFiles: 5
    });
    expect(report.manifest.assets.filter((asset) => asset.preload)).toHaveLength(5);
    expect(report.manifest.families.find((family) => family.family === 'Inter')?.version).toBe(
      'Version 4.001;git-66647c0bb'
    );
  });

  it.each(['inter-latin.woff2', 'inter.OFL.txt', 'google-fonts-source.txt'])(
    'rejects missing %s rather than accepting partial font coverage',
    (name) => {
      const root = fixture();
      rmSync(join(root, 'public/fonts', name));
      expect(() => auditBundledFonts(root)).toThrow();
    }
  );

  it.each(['inter-latin.woff2', 'inter.OFL.txt'])(
    'rejects a changed asset or truncated license: %s',
    (name) => {
      const root = fixture();
      writeFileSync(join(root, 'public/fonts', name), 'unreviewed');
      expect(() => auditBundledFonts(root)).toThrow();
    }
  );

  it('rejects duplicated inventory entries and subset drops', () => {
    const root = fixture();
    const path = join(root, 'public/fonts/manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest.assets[1] = manifest.assets[0];
    writeFileSync(path, JSON.stringify(manifest));
    expect(() => auditBundledFonts(root)).toThrow();
  });

  it('rejects extra files and symlink assets even when they point inside the payload', () => {
    const root = fixture();
    writeFileSync(join(root, 'public/fonts/extra.woff2'), 'extra');
    expect(() => auditBundledFonts(root)).toThrow('Unreviewed file');
    rmSync(join(root, 'public/fonts/extra.woff2'));
    const asset = join(root, 'public/fonts/inter-latin.woff2');
    rmSync(asset);
    symlinkSync('geist-latin.woff2', asset);
    expect(() => auditBundledFonts(root)).toThrow('non-symlink file');
  });

  it('correlates actual built CSS and refuses missing or remote font references', () => {
    const root = fixture();
    mkdirSync(join(root, '.next/static'), { recursive: true });
    const cssPath = join(root, '.next/static/fonts.css');
    const css = readFileSync(resolve('src/components/themes/fonts.css'), 'utf8');
    writeFileSync(cssPath, css);
    expect(auditBundledFonts(root, { payload: true }).fontFiles).toBe(28);
    writeFileSync(cssPath, css.replace('/fonts/inter-latin.woff2', '/missing.woff2'));
    expect(() => auditBundledFonts(root, { payload: true })).toThrow('missing bundled font');
    writeFileSync(cssPath, css + '\n@import "https://fonts.googleapis.com/css2";');
    expect(() => auditBundledFonts(root, { payload: true })).toThrow('remote Google font');
  });

  it('keeps existing variables/fallbacks and Latin preloads without a Google loader', () => {
    const config = readFileSync(resolve('src/components/themes/font.config.ts'), 'utf8');
    const css = readFileSync(resolve('src/components/themes/fonts.css'), 'utf8');
    const layout = readFileSync(resolve('src/app/layout.tsx'), 'utf8');
    const { manifest } = auditBundledFonts(fixture());
    expect(config).not.toContain('next/font/google');
    expect(layout).toContain('fontPreloads.map');
    expect(layout).toContain("crossOrigin='anonymous'");
    for (const family of manifest.families) {
      expect(css).toContain(`${family.variable}: '${family.family}', '${family.family} Fallback'`);
      expect(css).toContain(`size-adjust: ${family.fallback.sizeAdjust}%`);
      expect(config).toContain(`/fonts/${family.slug}-latin.woff2`);
    }
    expect(JSON.parse(readFileSync(resolve('package.json'), 'utf8')).scripts.build).toContain(
      '&& next build --webpack &&'
    );
  });

  it('checks ordinary build CSS without requiring standalone and enforces opted-in standalone', () => {
    const root = fixture();
    mkdirSync(join(root, '.next/static'), { recursive: true });
    writeFileSync(
      join(root, '.next/static/fonts.css'),
      readFileSync(resolve('src/components/themes/fonts.css'))
    );
    expect(auditBundledFonts(root, { built: true }).fontFiles).toBe(28);
    expect(() => auditBundledFonts(root, { built: true, standalone: true })).toThrow();
    mkdirSync(join(root, '.next/standalone'));
    writeFileSync(join(root, '.next/standalone/server.js'), '/* synthetic fixture only */');
    expect(auditBundledFonts(root, { built: true, standalone: true }).fontFiles).toBe(28);
  });
});
