#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Both images carry the upstream Node executable and license from the pinned
// build toolchain. Review this binding when upgrading Node.
const NODE_RELEASE = {
  version: '24.21.0',
  licenseSha256: '5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace',
  source: 'https://github.com/nodejs/node/blob/v24.21.0/LICENSE'
};

function isWithin(root, path) {
  return path === root || path.startsWith(root === sep ? sep : root + sep);
}

function fields(paragraph) {
  const result = {};
  for (const line of paragraph.split('\n')) {
    const match = /^([A-Za-z][A-Za-z-]*): (.*)$/.exec(line);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

/** Check the running Node release's complete upstream notice, including bundled notices. */
export function auditNodeRuntimeLicense(root, runtime = { version: process.versions.node, executable: process.execPath }) {
  const imageRoot = realpathSync(resolve(root));
  const paths = new Map([
    ['/nodejs/bin/node', 'nodejs/LICENSE'],
    ['/usr/local/bin/node', 'usr/local/LICENSE']
  ]);
  if (runtime.version !== NODE_RELEASE.version) throw new Error('Node release has no reviewed license binding');
  const licensePath = paths.get(runtime.executable);
  if (!licensePath) throw new Error('Node executable has no reviewed license location');
  const expected = join(imageRoot, licensePath);
  if (!existsSync(expected)) throw new Error('Node upstream license is missing');
  const actual = realpathSync(expected);
  if (!isWithin(imageRoot, actual)) throw new Error('Node license path escapes image root');
  if (!statSync(actual).isFile()) throw new Error('Node license is not a regular file');
  const licenseSha256 = createHash('sha256').update(readFileSync(actual)).digest('hex');
  if (licenseSha256 !== NODE_RELEASE.licenseSha256) throw new Error('Node upstream license digest mismatch');
  return { ...runtime, licensePath, licenseSha256, upstreamSource: NODE_RELEASE.source };
}

/** Inventory installed Debian packages and the adjacent copyright files in an OCI image. */
export function auditBaseImageCopyright(root) {
  const imageRoot = realpathSync(resolve(root));
  const statusDirectory = join(imageRoot, 'var/lib/dpkg/status.d');
  const statusFile = join(imageRoot, 'var/lib/dpkg/status');
  let source;
  let records;
  if (existsSync(statusDirectory) && statSync(statusDirectory).isDirectory()) {
    source = 'status.d';
    records = readdirSync(statusDirectory)
      .filter((name) => !name.endsWith('.md5sums'))
      .map((name) => fields(readFileSync(join(statusDirectory, name), 'utf8')));
  } else if (existsSync(statusFile)) {
    source = 'status';
    records = readFileSync(statusFile, 'utf8').split(/\n\s*\n/).map(fields);
  } else {
    throw new Error('Debian package status inventory is missing');
  }

  const packages = [];
  const seen = new Set();
  for (const record of records) {
    if (Object.keys(record).length === 0) continue;
    if (record.Status && record.Status !== 'install ok installed') continue;
    const name = record.Package;
    if (!name || !/^[a-z0-9][a-z0-9+.-]*$/.test(name) || !record.Version || seen.has(name)) {
      throw new Error('Debian package identity is missing, invalid or duplicated');
    }
    seen.add(name);
    const expected = join(imageRoot, 'usr/share/doc', name, 'copyright');
    let copyrightSha256 = null;
    if (existsSync(expected)) {
      const actual = realpathSync(expected);
      if (!isWithin(imageRoot, actual)) throw new Error(`copyright path escapes image root: ${name}`);
      const status = statSync(actual);
      if (status.isFile() && status.size > 0) {
        copyrightSha256 = createHash('sha256').update(readFileSync(actual)).digest('hex');
      }
    }
    packages.push({
      name,
      version: record.Version,
      architecture: record.Architecture ?? null,
      sourcePackage: record.Source ?? null,
      copyrightPath: copyrightSha256 ? `usr/share/doc/${name}/copyright` : null,
      copyrightSha256
    });
  }
  if (packages.length === 0) throw new Error('no installed Debian packages found');
  packages.sort((a, b) => a.name.localeCompare(b.name));
  return {
    statusSource: source,
    packageCount: packages.length,
    missingCopyrightCount: packages.filter((entry) => !entry.copyrightSha256).length,
    packages
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = process.argv[2];
    if (!root) throw new Error('expected image root path');
    const report = auditBaseImageCopyright(root);
    if (process.argv.includes('--node-runtime')) report.nodeRuntime = auditNodeRuntimeLicense(root);
    console.log(JSON.stringify(report, null, 2));
    if (process.argv.includes('--strict') && report.missingCopyrightCount > 0) process.exitCode = 1;
  } catch (error) {
    console.error(`base image copyright audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}
