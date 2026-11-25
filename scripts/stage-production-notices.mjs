#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, writeFileSync
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const noticeName = /^(?:licen[sc]es?|copying|notices?|copyrights?|authors|patents)(?:[._-]|$)/i;
const readmeName = /^readme(?:[._-]|$)/i;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const inside = (root, path) => path === root || path.startsWith(root + sep);

function regularFile(root, path) {
  if (!inside(root, resolve(path)) || !inside(root, realpathSync(path)) ||
      !lstatSync(path).isFile()) throw new Error(`Unsafe notice source: ${path}`);
  const bytes = readFileSync(path);
  if (!bytes.length) throw new Error(`Empty notice source: ${path}`);
  return bytes;
}

// This is deliberately a superset of bundled dependencies. Next's standalone
// package directories cannot account for code embedded in browser chunks.
export function stageProductionNotices(sourceRoot, graphPath, destination) {
  const root = realpathSync(sourceRoot);
  const output = resolve(destination);
  if (inside(root, output) || existsSync(output) || existsSync(output + '.staging')) {
    throw new Error('Notice output must be new and outside the source tree');
  }
  const packageBytes = regularFile(root, join(root, 'package.json'));
  const metadata = JSON.parse(packageBytes);
  const graphBytes = readFileSync(graphPath);
  const graphs = JSON.parse(graphBytes);
  const tree = graphs[0];
  if (graphs.length !== 1 || tree?.name !== metadata.name || tree.version !== metadata.version ||
      resolve(tree.path) !== root) throw new Error('Production graph root does not match source');
  const declaredRoots = Object.keys({ ...metadata.dependencies, ...metadata.optionalDependencies }).sort();
  if (JSON.stringify(Object.keys(tree.dependencies ?? {}).sort()) !== JSON.stringify(declaredRoots)) {
    throw new Error('Production graph does not cover the declared root dependencies');
  }

  const files = new Map();
  const components = new Map();
  const signatures = new Map();
  const put = (path, bytes) => {
    files.set(path, bytes);
    return { path, sha256: digest(bytes), size: bytes.length };
  };
  const rootDeclaration = put('project.package-json.NOTICE', packageBytes);

  function collect(directory) {
    const notices = [];
    const readmes = [];
    function scan(current, licenseDirectory = false) {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const path = join(current, entry.name);
        const selected = licenseDirectory || noticeName.test(entry.name);
        if (entry.isSymbolicLink()) {
          if (selected) throw new Error(`Symlinked notice: ${path}`);
          continue;
        }
        if (entry.isDirectory()) scan(path, selected);
        else if (selected) notices.push(path);
        else if (current === directory && readmeName.test(entry.name)) readmes.push(path);
      }
    }
    scan(directory);
    return { notices: notices.sort(), readmes: readmes.sort() };
  }

  function visit(dependencies, parent, parentKey, omittedAncestor = null) {
    for (const [name, node] of Object.entries(dependencies ?? {})) {
      if (typeof node.path !== 'string' || !inside(root, resolve(node.path)) || !node.version) {
        throw new Error(`Invalid dependency path/version: ${name}`);
      }
      const location = relative(root, resolve(node.path));
      let key = `${name}@${node.version}`;
      const manifestPath = join(node.path, 'package.json');
      if (!existsSync(manifestPath)) {
        if (existsSync(node.path)) throw new Error(`Installed dependency has no package.json: ${key}`);
        const optional = parent?.optionalDependencies?.[name];
        const omission = omittedAncestor ?? (optional ? { parent: parentKey, name, range: optional } : null);
        if (!omission) throw new Error(`Missing required production dependency: ${key}`);
        const old = components.get(key);
        if (old?.status === 'installed') throw new Error(`Conflicting installation: ${key}`);
        const entry = old ?? { name, version: node.version, status: 'omitted-optional', locations: [], optionalRoots: [] };
        if (!entry.locations.includes(location)) entry.locations.push(location);
        if (!entry.optionalRoots.some((o) => JSON.stringify(o) === JSON.stringify(omission))) entry.optionalRoots.push(omission);
        components.set(key, entry);
        visit(node.dependencies, null, key, omission);
        continue;
      }
      const directory = realpathSync(node.path);
      if (!inside(root, directory)) throw new Error(`Dependency escapes source: ${key}`);
      const declaration = regularFile(root, manifestPath);
      const pkg = JSON.parse(declaration);
      if (pkg.name !== name || !pkg.version ||
          (!/^(?:file:|link:)/.test(node.version) && pkg.version !== node.version)) {
        throw new Error(`Dependency identity mismatch: ${key}`);
      }
      key = `${pkg.name}@${pkg.version}`;
      const { notices, readmes } = collect(directory);
      const originals = [{ source: 'package.json', bytes: declaration, kind: 'declaration' }];
      for (const path of notices.length ? notices : readmes) {
        originals.push({ source: relative(directory, path), bytes: regularFile(directory, path), kind: notices.length ? 'notice' : 'readme' });
      }
      const signature = JSON.stringify(originals.map((o) => [o.source, digest(o.bytes)]));
      if (signatures.has(key) && signatures.get(key) !== signature) {
        throw new Error(`Conflicting original notices for ${key}`);
      }
      signatures.set(key, signature);
      const old = components.get(key);
      if (old && old.status !== 'installed') throw new Error(`Conflicting installation: ${key}`);
      const entry = old ?? {
        name: pkg.name, version: pkg.version, status: 'installed', license: pkg.license ?? null,
        evidence: notices.length ? 'notice-files' : readmes.length ? 'declaration-and-readme' : 'declaration-only',
        locations: [], files: originals.map((o) => ({
          source: o.source, kind: o.kind,
          ...put(`packages/${encodeURIComponent(key)}/${encodeURIComponent(o.source)}.NOTICE`, o.bytes)
        }))
      };
      if (!entry.locations.includes(location)) entry.locations.push(location);
      components.set(key, entry);
      visit(node.dependencies, pkg, key, omittedAncestor);
    }
  }
  visit(tree.dependencies, metadata, `${metadata.name}@${metadata.version}`);
  const sorted = [...components.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  const manifest = {
    schemaVersion: 1,
    scope: 'conservative-installed-production-graph; not an assertion of bundle membership or full license compliance',
    project: { name: metadata.name, version: metadata.version, declaration: rootDeclaration },
    lockfileSha256: digest(regularFile(root, join(root, 'pnpm-lock.yaml'))),
    graphSha256: digest(graphBytes),
    counts: { components: sorted.length, installed: sorted.filter((c) => c.status === 'installed').length,
      omittedOptional: sorted.filter((c) => c.status === 'omitted-optional').length },
    components: sorted
  };
  // Validate all sources before writing; publish only a verified complete bundle.
  const temporary = output + '.staging';
  try {
    mkdirSync(temporary, { recursive: true });
    for (const [path, bytes] of files) {
      mkdirSync(dirname(join(temporary, path)), { recursive: true });
      writeFileSync(join(temporary, path), bytes);
    }
    writeFileSync(join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    verifyProductionNotices(temporary);
    renameSync(temporary, output);
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}

/** @param {string} directory @param {string} [browserDirectory] */
export function verifyProductionNotices(directory, browserDirectory) {
  const root = realpathSync(directory);
  const manifest = json(join(root, 'manifest.json'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.components) || !manifest.components.length ||
      !/^[a-f0-9]{64}$/.test(manifest.lockfileSha256) || !/^[a-f0-9]{64}$/.test(manifest.graphSha256)) {
    throw new Error('Invalid production notice manifest');
  }
  const expected = new Set(['manifest.json']);
  function check(file) {
    if (typeof file.path !== 'string' || !file.path.endsWith('.NOTICE') ||
        file.path.split('/').some((s) => !s || s === '.' || s === '..') || expected.has(file.path)) {
      throw new Error('Unsafe or duplicate notice path');
    }
    const bytes = regularFile(root, join(root, file.path));
    if (bytes.length !== file.size || digest(bytes) !== file.sha256) throw new Error(`Notice digest mismatch: ${file.path}`);
    expected.add(file.path);
    return bytes;
  }
  const project = JSON.parse(check(manifest.project.declaration));
  if (project.name !== manifest.project.name || project.version !== manifest.project.version) throw new Error('Project identity mismatch');
  const installed = new Map([[`${project.name}@${project.version}`, project]]);
  const identities = new Set();
  for (const c of manifest.components) {
    const key = `${c.name}@${c.version}`;
    if (identities.has(key)) throw new Error('Duplicate production component');
    identities.add(key);
    if (c.status === 'omitted-optional') continue;
    if (c.status !== 'installed' || !c.files?.length || c.files[0].kind !== 'declaration') throw new Error('Invalid production component');
    const pkg = JSON.parse(check(c.files[0]));
    if (pkg.name !== c.name || pkg.version !== c.version || JSON.stringify(pkg.license ?? null) !== JSON.stringify(c.license)) throw new Error('Package declaration mismatch');
    installed.set(key, pkg);
    for (const file of c.files.slice(1)) check(file);
  }
  for (const c of manifest.components.filter((c) => c.status === 'omitted-optional')) {
    if (!c.optionalRoots?.length || c.optionalRoots.some((o) => !o.range || installed.get(o.parent)?.optionalDependencies?.[o.name] !== o.range)) {
      throw new Error('Missing optional dependency declaration evidence');
    }
  }
  if (manifest.counts.components !== identities.size || manifest.counts.installed !== installed.size - 1 ||
      manifest.counts.omittedOptional !== identities.size - installed.size + 1) throw new Error('Production notice counts mismatch');
  function scan(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const target = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Symlink in production notices');
      if (entry.isDirectory()) scan(target);
      else if (!entry.isFile() || !expected.delete(relative(root, target))) throw new Error('Unexpected production notice file');
    }
  }
  scan(root);
  if (expected.size) throw new Error('Missing production notice file');
  if (browserDirectory) {
    const browserRoot = realpathSync(browserDirectory);
    const sources = JSON.parse(regularFile(browserRoot, join(browserRoot, 'sources.json')));
    if (!Array.isArray(sources) || sources.length === 0) throw new Error('Empty browser notice index');
    const remaining = new Set(readdirSync(browserRoot));
    remaining.delete('sources.json');
    for (const entry of sources) {
      if (!installed.has(`${entry.package}@${entry.version}`)) {
        throw new Error(`Browser notice package is not installed: ${entry.package}@${entry.version}`);
      }
      if (typeof entry.file !== 'string' || !/^[A-Za-z0-9@._+-]+\.NOTICE$/.test(entry.file) ||
          !remaining.delete(entry.file)) throw new Error('Invalid or missing browser notice file');
      const bytes = regularFile(browserRoot, join(browserRoot, entry.file));
      if (digest(bytes) !== entry.sha256) throw new Error(`Browser notice digest mismatch: ${entry.file}`);
    }
    if (remaining.size) throw new Error('Unindexed browser notice files');
    return { status: 'PASS', ...manifest.counts, browserNotices: sources.length };
  }
  return { status: 'PASS', ...manifest.counts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === 'stage' && args.length === 3) console.log(JSON.stringify(stageProductionNotices(...args).counts));
    else if (mode === 'verify' && (args.length === 1 || args.length === 2)) console.log(JSON.stringify(verifyProductionNotices(...args)));
    else throw new Error('Usage: stage-production-notices.mjs stage SOURCE GRAPH OUTPUT | verify OUTPUT [BROWSER_NOTICES]');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
