#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventoryRuntimePackages } from './runtime-license-audit.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function safePath(root, name) {
  if (typeof name !== 'string' || name.includes('\\') || name.split('/').some((p) => !p || p === '.' || p === '..')) {
    throw new Error('unsafe vendored notice path');
  }
  let path = root;
  for (const part of name.split('/')) {
    path = join(path, part);
    try {
      if (lstatSync(path).isSymbolicLink()) throw new Error('vendored notice symlink');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return path;
}

function checkedFile(root, name, sha256) {
  const path = safePath(root, name);
  if (!/^[a-f0-9]{64}$/.test(sha256) || !lstatSync(path).isFile() || digest(readFileSync(path)) !== sha256) {
    throw new Error(`vendored source digest mismatch: ${name}`);
  }
  return path;
}

/** Verify direct-component notices against the traced bytes, not all bundled obligations. */
export function verifyNextVendoredNotices(root, noticeDirectory = join(root, 'third_party/next-vendored')) {
  const app = realpathSync(root);
  if (lstatSync(noticeDirectory).isSymbolicLink()) throw new Error('vendored notice symlink');
  const notices = realpathSync(noticeDirectory);
  const manifest = JSON.parse(readFileSync(safePath(notices, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.parent?.name !== 'next' || !manifest.components?.length) {
    throw new Error('invalid vendored notice manifest');
  }
  const parents = inventoryRuntimePackages(app, { scanNativeFiles: false }).packages.filter((p) => p.name === 'next');
  if (parents.length !== 1 || parents[0].version !== manifest.parent.version) {
    throw new Error('Next version differs from vendored notice binding');
  }
  const roots = [...new Set(parents[0].locations.map((p) => realpathSync(join(app, p))))];
  const seen = new Set();
  for (const component of manifest.components) {
    if (!component.directory.startsWith('dist/compiled/') || seen.has(component.directory) || !component.payloadFiles?.length) {
      throw new Error('invalid or duplicate vendored component');
    }
    seen.add(component.directory);
    checkedFile(notices, component.notice.file, component.notice.sha256);
  }
  const components = [];
  const supplemental = manifest.supplementalNotices ?? [];
  if (!Array.isArray(supplemental)) throw new Error('invalid supplemental notices');
  for (const item of supplemental) {
    if (!item.payload?.path?.startsWith('dist/compiled/')) throw new Error('invalid supplemental payload');
    checkedFile(notices, item.notice.file, item.notice.sha256);
  }
  const tracedSupplementalNotices = [];
  for (const parent of roots) {
    if (!parent.startsWith(app + sep)) throw new Error('Next package escapes runtime root');
    checkedFile(parent, 'package.json', manifest.parent.packageJsonSha256);
    for (const item of supplemental) {
      const payload = safePath(parent, item.payload.path);
      if (!existsSync(payload)) continue;
      checkedFile(parent, item.payload.path, item.payload.sha256);
      tracedSupplementalNotices.push({ name: item.name, version: item.version, notice: item.notice, payload: item.payload });
    }
    for (const component of manifest.components) {
      const directory = safePath(parent, component.directory);
      if (!existsSync(directory)) continue; // Untraced components are not added to the runtime.
      const known = new Map(component.payloadFiles.map((f) => [f.path, f.sha256]));
      if (known.size !== component.payloadFiles.length) throw new Error('duplicate vendored payload binding');
      const verifiedFiles = [];
      function visit(current) {
        for (const entry of readdirSync(current).sort()) {
          const path = join(current, entry);
          const stat = lstatSync(path);
          if (stat.isSymbolicLink()) throw new Error('vendored payload symlink');
          if (stat.isDirectory()) visit(path);
          else if (stat.isFile()) {
            const name = relative(directory, path).split(sep).join('/');
            if (!known.has(name)) throw new Error(`unbound vendored payload: ${component.directory}/${name}`);
            checkedFile(directory, name, known.get(name));
            verifiedFiles.push(name);
          } else throw new Error('unsupported vendored payload file');
        }
      }
      visit(directory);
      if (verifiedFiles.length) components.push({
        name: component.name,
        version: component.version,
        license: component.license,
        location: relative(app, directory),
        notice: component.notice,
        verifiedFiles
      });
    }
  }
  if (!components.length) throw new Error('no matching traced vendored payload');
  return {
    parent: `${parents[0].name}@${parents[0].version}`,
    manifestSha256: digest(readFileSync(join(notices, 'manifest.json'))),
    originalNoticeCount: manifest.components.length,
    tracedComponentCount: components.length,
    supplementalNoticeCount: supplemental.length,
    tracedSupplementalNotices,
    components,
    coverage: 'listed original direct and supplemental notices only; complete transitive, native and browser reconciliation remains separate'
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('expected application root');
    console.log(JSON.stringify(verifyNextVendoredNotices(process.argv[2], process.argv[3]), null, 2));
  } catch (error) {
    console.error(`vendored notice verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
