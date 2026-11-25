#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditBundledFonts } from './font-assets-audit.mjs';

function command(commandName, commandArgs, cwd = process.cwd()) {
  const result = spawnSync(commandName, commandArgs, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `${commandName} ${commandArgs.join(' ')} failed`);
  }
  return result.stdout;
}

/** @param {string} root @param {string | null | undefined} claimedRevision */
export function captureSourceSnapshot(root = process.cwd(), claimedRevision = null) {
  const repository = realpathSync(resolve(root));
  const git = (args) => command('git', args, repository);
  if (realpathSync(git(['rev-parse', '--show-toplevel']).trim()) !== repository) {
    throw new Error('SBOM must be generated from the product Git root');
  }
  const revision = git(['rev-parse', 'HEAD']).trim();
  if (claimedRevision && claimedRevision !== revision) {
    throw new Error('claimed source revision does not match checkout HEAD');
  }
  const objectFormat = git(['rev-parse', '--show-object-format']).trim();
  if (objectFormat !== 'sha1' && objectFormat !== 'sha256') {
    throw new Error('unsupported Git object format');
  }
  const committed = new Map();
  for (const entry of git(['ls-tree', '-rz', '--full-tree', 'HEAD']).split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const [mode, type, oid] = entry.slice(0, tab).split(' ');
    if (type !== 'blob') throw new Error('source snapshot does not support Git submodules');
    committed.set(entry.slice(tab + 1), { mode, oid });
  }
  const paths = new Set([
    ...committed.keys(),
    ...git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean)
  ]);
  let dirty = Boolean(git(['status', '--porcelain=v1', '-z', '--untracked-files=all']));
  const digest = createHash('sha256');
  for (const path of [...paths].sort()) {
    let status;
    try {
      status = lstatSync(join(repository, path));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      digest.update(JSON.stringify([path, 'deleted']) + '\n');
      dirty = true;
      continue;
    }
    if (!status.isFile() && !status.isSymbolicLink()) {
      throw new Error('source snapshot encountered a non-file Git entry');
    }
    const mode = status.isSymbolicLink() ? '120000' : status.mode & 0o111 ? '100755' : '100644';
    const contents = status.isSymbolicLink()
      ? Buffer.from(readlinkSync(join(repository, path)))
      : readFileSync(join(repository, path));
    const contentSha256 = createHash('sha256').update(contents).digest('hex');
    const blobId = createHash(objectFormat)
      .update(`blob ${contents.length}\0`)
      .update(contents)
      .digest('hex');
    const original = committed.get(path);
    if (!original || original.mode !== mode || original.oid !== blobId) dirty = true;
    digest.update(JSON.stringify([path, mode, contentSha256]) + '\n');
  }
  return {
    revision,
    worktreeState: dirty ? 'dirty' : 'clean',
    sourceTreeSha256: digest.digest('hex'),
    fileCount: paths.size
  };
}

export function packageUrl(name, version) {
  return `pkg:npm/${name.split('/').map(encodeURIComponent).join('/')}@${encodeURIComponent(version)}`;
}

export function sbomTarget(role = 'application') {
  if (role === 'application') return {
    role, lockfilePath: 'pnpm-lock.yaml', packagePath: 'package.json',
    imageTitle: 'WorldLoom', output: 'artifacts/worldloom-sbom.cdx.json',
    listArgs: ['list', '--prod', '--depth', 'Infinity', '--json']
  };
  if (role === 'migration') return {
    role, lockfilePath: 'docker/migrate/pnpm-lock.yaml', packagePath: 'docker/migrate/package.json',
    imageTitle: 'WorldLoom Migration', output: 'artifacts/worldloom-migrate-sbom.cdx.json',
    listArgs: ['--dir', 'docker/migrate', 'list', '--prod', '--depth', 'Infinity', '--json', '--lockfile-only']
  };
  throw new Error('unsupported SBOM role: ' + role);
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

export function buildBom(tree, {
  lockfile, snapshot,
  artifactRole = 'application',
  fontManifest = /** @type {import('./font-assets-audit.mjs').FontManifest | null} */ (null)
}) {
  const target = sbomTarget(artifactRole);
  if (artifactRole === 'migration' && fontManifest) throw new Error('migration SBOM must not contain application fonts');
  const components = new Map();
  const dependencies = new Map();

  function visit(parentRef, packageName, node) {
    if (!node || typeof node !== 'object' || typeof node.version !== 'string') return null;
    const local = /^(file|link):/.test(node.version);
    let version = node.version;
    if (local) {
      const metadata = JSON.parse(readFileSync(join(node.path, 'package.json'), 'utf8'));
      if (metadata.name !== packageName || typeof metadata.version !== 'string' || !metadata.version.trim()) {
        throw new Error(`Local dependency metadata does not identify ${packageName}`);
      }
      version = metadata.version;
    }
    const ref = packageUrl(packageName, version);
    if (!components.has(ref)) {
      const component = {
        type: 'library',
        'bom-ref': ref,
        name: packageName,
        version,
        purl: ref
      };
      const license = packageLicense(node.path);
      if (license) component.licenses = [{ license }];
      if (typeof node.resolved === 'string') {
        component.properties = [{ name: 'worldloom:resolved', value: node.resolved }];
      }
      if (local) {
        component.properties = [
          ...(component.properties ?? []),
          { name: 'worldloom:local-dependency', value: node.version }
        ];
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

  // Browser/static font files are not npm packages. Keep their exact bytes,
  // original sources and separate OFL notices in the distribution inventory.
  for (const asset of fontManifest?.assets ?? []) {
    const family = fontManifest.families.find((value) => value.family === asset.family);
    const ref = `urn:worldloom:font:${asset.file}:${asset.sha256}`;
    components.set(ref, {
      type: 'file', 'bom-ref': ref, name: asset.file, version: family.version,
      hashes: [{ alg: 'SHA-256', content: asset.sha256 }],
      licenses: [{ license: { id: 'OFL-1.1' } }], copyright: family.copyright,
      externalReferences: [{ type: 'distribution', url: asset.source }],
      properties: [
        { name: 'worldloom:font-family', value: family.family },
        { name: 'worldloom:font-license-file', value: `public/fonts/${family.licenseFile}` },
        { name: 'worldloom:font-license-sha256', value: family.licenseSha256 }
      ]
    });
    const children = dependencies.get(rootRef) ?? new Set();
    children.add(ref);
    dependencies.set(rootRef, children);
  }

  const lockfileSha256 = createHash('sha256').update(lockfile).digest('hex');
  return {
    $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: {
        components: [
          { type: 'application', publisher: 'WorldLoom', name: 'generate-sbom.mjs', version: '1.2.0' }
        ]
      },
      component: {
        type: 'application',
        'bom-ref': rootRef,
        name: tree.name ?? 'worldloom',
        version: tree.version ?? '0.0.0',
        purl: rootRef,
        properties: [
          { name: 'worldloom:source-revision', value: snapshot.revision },
          { name: 'worldloom:source-worktree-state', value: snapshot.worktreeState },
          { name: 'worldloom:source-tree-sha256', value: snapshot.sourceTreeSha256 },
          { name: 'worldloom:artifact-role', value: artifactRole },
          { name: 'worldloom:lockfile-path', value: target.lockfilePath },
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
}

function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const roleIndex = args.indexOf('--role');
  if (roleIndex >= 0 && (!args[roleIndex + 1] || args[roleIndex + 1].startsWith('--'))) {
    throw new Error('--role requires application or migration');
  }
  const target = sbomTarget(roleIndex >= 0 ? args[roleIndex + 1] : 'application');
  const outputIndex = args.indexOf('--output');
  if (outputIndex >= 0 && (!args[outputIndex + 1] || args[outputIndex + 1].startsWith('--'))) {
    throw new Error('--output requires a file path');
  }
  const outputPath = resolve(outputIndex >= 0 ? args[outputIndex + 1] : target.output);
  const snapshot = captureSourceSnapshot(process.cwd(), process.env.GITHUB_SHA?.trim());
  if (args.includes('--release')) {
    if (snapshot.worktreeState !== 'clean') throw new Error('release SBOM requires a clean source checkout');
    const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', outputPath]);
    if (ignored.status !== 0) throw new Error('release SBOM output must be a Git-ignored artifact path');
  }
  const lockfile = readFileSync(resolve(target.lockfilePath));
  const tree = JSON.parse(command('pnpm', target.listArgs))[0];
  const metadata = JSON.parse(readFileSync(resolve(target.packagePath), 'utf8'));
  if (!tree || tree.name !== metadata.name || tree.version !== metadata.version) {
    throw new Error('dependency tree root does not match the selected package');
  }
  const fontManifest = target.role === 'application' ? auditBundledFonts(process.cwd()).manifest : null;
  const bom = buildBom(tree, { lockfile, snapshot, fontManifest, artifactRole: target.role });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`);
  console.log(JSON.stringify({
    output: outputPath,
    format: `${bom.bomFormat} ${bom.specVersion}`,
    components: bom.components.length,
    artifactRole: target.role,
    lockfilePath: target.lockfilePath,
    ...snapshot,
    lockfileSha256: createHash('sha256').update(lockfile).digest('hex')
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error('SBOM generation failed: ' + error.message);
    process.exitCode = 1;
  }
}
