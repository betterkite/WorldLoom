#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = resolve(
  process.cwd(),
  outputIndex >= 0
    ? (args[outputIndex + 1] ?? 'artifacts/worldloom-sbom.cdx.json')
    : 'artifacts/worldloom-sbom.cdx.json'
);

if (outputIndex >= 0 && !args[outputIndex + 1]) {
  throw new Error('--output requires a file path');
}

function command(commandName, commandArgs) {
  const result = spawnSync(commandName, commandArgs, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `${commandName} ${commandArgs.join(' ')} failed`);
  }
  return result.stdout;
}

function sourceRevision() {
  return process.env.GITHUB_SHA?.trim() || command('git', ['rev-parse', 'HEAD']).trim();
}

function packageUrl(name, version) {
  const encodedName = name.startsWith('@')
    ? `%40${name.slice(1).replaceAll('/', '%2F')}`
    : name;
  return `pkg:npm/${encodedName}@${version}`;
}

function packageLicense(path) {
  try {
    const packageJson = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
    const license = packageJson.license;
    if (typeof license === 'string' && license.trim()) return { name: license.trim() };
    if (license && typeof license === 'object' && typeof license.type === 'string') {
      return { name: license.type };
    }
  } catch {
    // Package metadata is optional for SBOM generation; keep the component.
  }
  return null;
}

const lockfile = readFileSync(resolve(process.cwd(), 'pnpm-lock.yaml'));
const listOutput = command('pnpm', ['list', '--prod', '--depth', 'Infinity', '--json']);
const tree = JSON.parse(listOutput)[0];
const components = new Map();
const dependencies = new Map();

function visit(parentRef, packageName, node) {
  if (!node || typeof node !== 'object' || typeof node.version !== 'string') return null;
  const ref = packageUrl(packageName, node.version);
  if (!components.has(ref)) {
    const component = {
      type: 'library',
      'bom-ref': ref,
      name: packageName,
      version: node.version,
      purl: ref
    };
    const license = packageLicense(node.path);
    if (license) component.licenses = [{ license }];
    if (typeof node.resolved === 'string') {
      component.properties = [{ name: 'worldloom:resolved', value: node.resolved }];
    }
    components.set(ref, component);
  }
  if (parentRef) {
    const children = dependencies.get(parentRef) ?? new Set();
    children.add(ref);
    dependencies.set(parentRef, children);
  }
  for (const [childName, childNode] of Object.entries(node.dependencies ?? {})) {
    visit(ref, childName, childNode);
  }
  return ref;
}

const rootRef = packageUrl(tree.name ?? 'worldloom', tree.version ?? '0.0.0');
for (const [name, node] of Object.entries(tree.dependencies ?? {})) visit(rootRef, name, node);

const lockfileSha256 = createHash('sha256').update(lockfile).digest('hex');
const revision = sourceRevision();
const bom = {
  $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${lockfileSha256.slice(0, 32)}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: {
      components: [
        { type: 'application', vendor: 'WorldLoom', name: 'generate-sbom.mjs', version: '1.0.0' }
      ]
    },
    component: {
      type: 'application',
      'bom-ref': rootRef,
      name: tree.name ?? 'worldloom',
      version: tree.version ?? '0.0.0',
      purl: rootRef,
      properties: [
        { name: 'worldloom:source-revision', value: revision },
        { name: 'worldloom:pnpm-lock-sha256', value: lockfileSha256 }
      ]
    }
  },
  components: [...components.values()].sort((left, right) =>
    left['bom-ref'].localeCompare(right['bom-ref'])
  ),
  dependencies: [...dependencies.entries()]
    .map(([ref, children]) => ({ ref, dependsOn: [...children].sort() }))
    .sort((left, right) => left.ref.localeCompare(right.ref))
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      output: outputPath,
      format: `${bom.bomFormat} ${bom.specVersion}`,
      components: bom.components.length,
      sourceRevision: revision,
      lockfileSha256
    },
    null,
    2
  )
);
