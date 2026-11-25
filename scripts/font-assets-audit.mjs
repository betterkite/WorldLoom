#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{family: string, slug: string, variable: string, version: string,
 * weight: string, style: string, license: string, copyright: string,
 * licenseFile: string, licenseSource: string, licenseSha256: string,
 * licenseBytes: number, subsets: string[], fallback: {family: string,
 * ascent: string, descent: string, lineGap: string, fallbackFont: string,
 * sizeAdjust: string}}} FontFamily
 * @typedef {{family: string, file: string, subset: string, preload: boolean,
 * source: string, sha256: string, bytes: number, unicodeRange: string}} FontAsset
 * @typedef {{schemaVersion: number, acquiredOn: string, licenseCatalogCommit: string,
 * sourceCssFile: string, cssRequest: {url: string, userAgent: string},
 * families: FontFamily[], assets: FontAsset[]}} FontManifest
 */

const families = new Map([
  ['Geist', ['geist', '100 900', 5]],
  ['Geist Mono', ['geist-mono', '100 900', 6]],
  ['Inter', ['inter', '100 900', 7]],
  ['JetBrains Mono', ['jetbrains-mono', '100 800', 6]],
  ['Playfair Display', ['playfair-display', '400 900', 4]]
]);
const hash = (value) => createHash('sha256').update(value).digest('hex');

function file(path, limit) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > limit) {
    throw new Error('Font inventory requires a bounded, regular, non-symlink file');
  }
  return readFileSync(path);
}

function directory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Font inventory requires non-symlink directories');
  }
}

/** Validate original font bytes and complete notices, never fetch or infer a
 * license grant. The committed manifest is review input, not legal approval.
 * built/payload additionally correlate the real production CSS with assets.
 */
export function auditBundledFonts(root, { built = false, payload = false, standalone = false } = {}) {
  const app = realpathSync(resolve(root));
  const publicRoot = join(app, 'public');
  const fontRoot = join(publicRoot, 'fonts');
  directory(publicRoot);
  directory(fontRoot);
  const manifestBytes = file(join(fontRoot, 'manifest.json'), 128 * 1024);
  const manifest = /** @type {FontManifest} */ (JSON.parse(manifestBytes.toString('utf8')));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.licenseCatalogCommit !== '9710da1eacb3be272583c3224dcb70f9da6eadbb' ||
    manifest.sourceCssFile !== 'google-fonts-source.txt' ||
    manifest.families?.length !== 5 ||
    manifest.assets?.length !== 28
  ) {
    throw new Error('Font inventory identity or complete coverage is invalid');
  }
  const sourceCss = file(join(fontRoot, manifest.sourceCssFile), 32 * 1024).toString('utf8');
  const definitions = [...sourceCss.matchAll(/@font-face\s*\{([^}]+)\}/g)];
  if (definitions.length !== 28) throw new Error('Official font CSS coverage is incomplete');
  const seenFamilies = new Set();
  const expectedFiles = new Set(['manifest.json', 'google-fonts-source.txt', 'README.md']);
  for (const family of manifest.families) {
    const expected = families.get(family.family);
    if (
      !expected || seenFamilies.has(family.family) || family.slug !== expected[0] ||
      family.weight !== expected[1] || family.style !== 'normal' ||
      family.license !== 'OFL-1.1' || family.licenseFile !== `${family.slug}.OFL.txt` ||
      !/^https:\/\/raw\.githubusercontent\.com\/google\/fonts\/9710da1eacb3be272583c3224dcb70f9da6eadbb\/ofl\/[a-z]+\/OFL\.txt$/.test(family.licenseSource) ||
      manifest.assets.filter((asset) => asset.family === family.family).length !== expected[2]
    ) {
      throw new Error('Font family, license source or subset coverage is invalid');
    }
    seenFamilies.add(family.family);
    const license = file(join(fontRoot, family.licenseFile), 16 * 1024);
    const text = license.toString('utf8');
    if (
      license.length !== family.licenseBytes || hash(license) !== family.licenseSha256 ||
      typeof family.copyright !== 'string' || !text.startsWith(family.copyright + '\n') ||
      !text.includes('SIL OPEN FONT LICENSE Version 1.1') ||
      !text.includes('TERMINATION') || !text.includes('DISCLAIMER')
    ) {
      throw new Error('Font copyright or complete original license digest is invalid');
    }
    expectedFiles.add(family.licenseFile);
  }
  const seenAssets = new Set();
  let fontBytes = 0;
  for (const asset of manifest.assets) {
    const family = manifest.families.find((value) => value.family === asset.family);
    if (
      !family || !family.subsets.includes(asset.subset) ||
      !/^[a-z0-9-]+\.woff2$/.test(asset.file) ||
      asset.file !== `${family.slug}-${asset.subset}.woff2` ||
      seenAssets.has(asset.file) || asset.preload !== (asset.subset === 'latin') ||
      !/^https:\/\/fonts\.gstatic\.com\/s\/[a-z]+\/v[0-9]+\/[A-Za-z0-9_-]+\.woff2$/.test(asset.source) ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)
    ) {
      throw new Error('Font asset, original source or preload contract is invalid');
    }
    const definition = definitions.find((match) => match[1].includes(`url(${asset.source})`))?.[1];
    if (
      !definition?.includes(`font-family: '${asset.family}';`) ||
      !definition.includes(`font-weight: ${family.weight};`) ||
      !definition.includes(`unicode-range: ${asset.unicodeRange};`)
    ) {
      throw new Error('Font source CSS and manifest do not agree');
    }
    const contents = file(join(fontRoot, asset.file), 256 * 1024);
    if (
      contents.length !== asset.bytes || hash(contents) !== asset.sha256 ||
      contents.subarray(0, 4).toString('ascii') !== 'wOF2' || contents.length < 48 ||
      contents.readUInt32BE(8) !== contents.length
    ) {
      throw new Error('Original WOFF2 bytes are missing, corrupt or unreviewed');
    }
    seenAssets.add(asset.file);
    expectedFiles.add(asset.file);
    fontBytes += contents.length;
  }
  for (const entry of readdirSync(fontRoot, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !expectedFiles.has(entry.name)) {
      throw new Error('Unreviewed file or symlink in bundled font payload');
    }
  }
  if (built || payload) {
    const staticRoot = join(app, '.next', 'static');
    directory(join(app, '.next'));
    directory(staticRoot);
    const pending = [staticRoot];
    const found = new Set();
    let scanned = 0;
    while (pending.length) {
      const current = pending.pop();
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (++scanned > 4096 || entry.isSymbolicLink()) {
          throw new Error('Production font CSS inventory is unbounded or symlinked');
        }
        const path = join(current, entry.name);
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile() && entry.name.endsWith('.css')) {
          const css = file(path, 2 * 1024 * 1024).toString('utf8');
          if (/fonts\.(?:googleapis|gstatic)\.com/.test(css)) {
            throw new Error('Production CSS still has a remote Google font dependency');
          }
          for (const asset of manifest.assets) {
            if (css.includes(`/fonts/${asset.file}`)) found.add(asset.file);
          }
        }
      }
    }
    if (found.size !== 28) throw new Error('Production CSS is missing bundled font references');
    if (built && standalone) file(join(app, '.next', 'standalone', 'server.js'), 4 * 1024 * 1024);
  }
  return {
    fontFamilies: 5, fontFiles: 28, fontBytes, licenseFiles: 5,
    manifestSha256: hash(manifestBytes), manifest
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { manifest: _manifest, ...result } = auditBundledFonts(process.argv[2] ?? '.', {
      built: process.argv.includes('--built'), payload: process.argv.includes('--payload'),
      standalone: process.env.BUILD_STANDALONE === 'true'
    });
    console.log(JSON.stringify({ status: 'PASS', ...result }));
  } catch (error) {
    console.error('Bundled font audit failed: ' + error.message);
    process.exitCode = 1;
  }
}
