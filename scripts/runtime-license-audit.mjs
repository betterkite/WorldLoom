#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const noticeFilename = /^(?:licen[sc]e|copying|notice)(?:[._-]|$)/i;
const nativeFilename = /\.(?:node|dll|dylib|exe|so(?:\.\d+)*)$/i;
const prismaLicenseSha256 = 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4';
const sha256 = (contents) => createHash('sha256').update(contents).digest('hex');

function verifiedPrismaEngineProvenance(appRoot, nativeFiles) {
  const manifestPath = join(appRoot, 'third_party/prisma-engine-provenance.json');
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const version = '6.19.3';
  if (
    manifest.schemaVersion !== 1 ||
    manifest.sourcePackage !== '@prisma/engines' ||
    manifest.sourceVersion !== version ||
    manifest.sourceLicense !== 'Apache-2.0' ||
    manifest.licenseSha256 !== prismaLicenseSha256 ||
    manifest.generatedClientVersion !== version ||
    typeof manifest.enginePath !== 'string' ||
    typeof manifest.licensePath !== 'string' ||
    !/^node_modules\/\.pnpm\/@prisma\+client@6\.19\.3[^/]*\/node_modules\/\.prisma\/client\/libquery_engine-(?:linux-arm64|debian)-openssl-3\.0\.x\.so\.node$/.test(manifest.enginePath) ||
    manifest.licensePath !== join(manifest.enginePath, '..', 'LICENSE.prisma-engines')
  ) {
    throw new Error('Prisma engine provenance manifest is invalid or stale');
  }
  const verifiedFile = (relativePath, expectedSha256) => {
    if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
      throw new Error('Prisma engine provenance digest is invalid');
    }
    const path = realpathSync(join(appRoot, relativePath));
    if (!path.startsWith(appRoot + sep) || !isFile(path)) {
      throw new Error('Prisma engine provenance file is outside the runtime or empty');
    }
    if (sha256(readFileSync(path)) !== expectedSha256) {
      throw new Error('Prisma engine provenance digest mismatch');
    }
    return path;
  };
  verifiedFile(manifest.enginePath, manifest.engineSha256);
  const licenseFile = verifiedFile(manifest.licensePath, manifest.licenseSha256);
  if (!readFileSync(licenseFile, 'utf8').includes('Apache License')) {
    throw new Error('Prisma engine source license text is invalid');
  }
  const generated = JSON.parse(readFileSync(join(appRoot, manifest.enginePath, '../package.json'), 'utf8'));
  if (generated.version !== version) throw new Error('generated Prisma Client version is stale');
  if (!nativeFiles.some((file) => file.path === manifest.enginePath)) {
    throw new Error('Prisma engine provenance does not match a native file');
  }
  return [{ path: manifest.enginePath, sourcePackage: '@prisma/engines@6.19.3', sha256: manifest.engineSha256 }];
}

function isNativeFile(path, filename, status) {
  if (nativeFilename.test(filename)) return true;
  if (!(status.mode & 0o111)) return false;
  const descriptor = openSync(path, 'r');
  try {
    const magic = Buffer.alloc(4);
    if (readSync(descriptor, magic, 0, 4, 0) < 4) return false;
    const signature = magic.readUInt32BE(0);
    return (
      signature === 0x7f454c46 || // ELF
      signature === 0xfeedface ||
      signature === 0xcefaedfe ||
      signature === 0xfeedfacf ||
      signature === 0xcffaedfe || // Mach-O
      (magic[0] === 0x4d && magic[1] === 0x5a) // PE/COFF
    );
  } finally {
    closeSync(descriptor);
  }
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path) {
  try {
    const status = statSync(path);
    return status.isFile() && status.size > 0;
  } catch {
    return false;
  }
}

export function inventoryRuntimePackages(root, { scanNativeFiles = true } = {}) {
  const appRoot = realpathSync(resolve(root));
  const nodeModules = join(appRoot, 'node_modules');
  if (!isDirectory(nodeModules)) throw new Error('runtime node_modules directory is missing');

  const packages = new Map();
  const scannedNativeDirectories = new Set();
  const scannedNodeModules = new Set();

  function findNativeFiles(directory, skipNestedNodeModules = true) {
    const found = [];
    const pending = [directory];
    while (pending.length) {
      const current = pending.pop();
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isDirectory() && (!skipNestedNodeModules || entry.name !== 'node_modules')) {
          pending.push(path);
        } else if (entry.isFile()) {
          const status = statSync(path);
          if (isNativeFile(path, entry.name, status)) {
            found.push({ path: relative(appRoot, path), size: status.size });
          }
        }
      }
    }
    return found;
  }

  function addPackage(directory) {
    const packageJson = join(directory, 'package.json');
    if (!existsSync(packageJson)) return;
    const actualPath = realpathSync(directory);
    if (actualPath !== appRoot && !actualPath.startsWith(appRoot + sep)) {
      throw new Error('runtime package resolves outside the application root');
    }

    const metadata = JSON.parse(readFileSync(packageJson, 'utf8'));
    if (!metadata.name || !metadata.version) {
      throw new Error('runtime package is missing name or version');
    }
    const key = `${metadata.name}@${metadata.version}`;
    const existing = packages.get(key) ?? {
      name: metadata.name,
      version: metadata.version,
      license: metadata.license ?? null,
      locations: [],
      noticeFiles: [],
      nativeFiles: []
    };
    if (existing.license !== (metadata.license ?? null)) {
      throw new Error('runtime package has conflicting license metadata');
    }
    existing.locations.push(relative(appRoot, directory));
    if (scanNativeFiles && !scannedNativeDirectories.has(actualPath)) {
      existing.nativeFiles.push(...findNativeFiles(actualPath));
      scannedNativeDirectories.add(actualPath);
    }
    for (const filename of readdirSync(directory).filter(
      (name) => noticeFilename.test(name) && isFile(join(directory, name))
    )) {
      const noticePath = join(directory, filename);
      const actualNotice = realpathSync(noticePath);
      if (!actualNotice.startsWith(appRoot + sep)) {
        throw new Error('runtime notice resolves outside the application root');
      }
      const notice = relative(appRoot, noticePath);
      if (!existing.noticeFiles.includes(notice)) existing.noticeFiles.push(notice);
    }
    packages.set(key, existing);
    scanNodeModules(join(directory, 'node_modules'));
  }

  function scanNodeModules(directory) {
    if (!isDirectory(directory)) return;
    const actual = realpathSync(directory);
    if (!actual.startsWith(appRoot + sep)) throw new Error('nested node_modules resolves outside the application root');
    if (scannedNodeModules.has(actual)) return;
    scannedNodeModules.add(actual);
    for (const name of readdirSync(directory).sort()) {
      if (name.startsWith('.')) continue;
      const child = join(directory, name);
      if (!isDirectory(child)) continue;
      if (name.startsWith('@')) {
        for (const packageName of readdirSync(child).sort()) {
          const scopedPackage = join(child, packageName);
          if (isDirectory(scopedPackage)) addPackage(scopedPackage);
        }
      } else {
        addPackage(child);
      }
    }
  }

  scanNodeModules(nodeModules);
  const pnpmStore = join(nodeModules, '.pnpm');
  if (isDirectory(pnpmStore)) {
    for (const slot of readdirSync(pnpmStore).sort()) {
      scanNodeModules(join(pnpmStore, slot, 'node_modules'));
    }
  }

  const inventory = [...packages.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)
  );
  for (const entry of inventory) {
    entry.locations.sort();
    entry.noticeFiles.sort();
    entry.nativeFiles.sort((a, b) => a.path.localeCompare(b.path));
  }
  const attributedNativePaths = new Set(
    inventory.flatMap((entry) => entry.nativeFiles.map((file) => file.path))
  );
  const allNativeFiles = scanNativeFiles
    ? findNativeFiles(appRoot, false).sort((a, b) => a.path.localeCompare(b.path))
    : [];
  const declaredNativeProvenance = scanNativeFiles
    ? verifiedPrismaEngineProvenance(appRoot, allNativeFiles)
    : [];
  for (const provenance of declaredNativeProvenance) attributedNativePaths.add(provenance.path);
  const missing = inventory.filter((entry) => entry.noticeFiles.length === 0);
  const withoutLicenseMetadata = inventory.filter(
    (entry) => typeof entry.license !== 'string' || !entry.license.trim()
  );
  const fileDigest = (path) => {
    const actualPath = realpathSync(join(appRoot, path));
    if (!actualPath.startsWith(appRoot + sep) || !isFile(actualPath)) {
      throw new Error('runtime evidence file is outside the application root or empty');
    }
    return { path, sha256: sha256(readFileSync(actualPath)) };
  };
  const noticeDigests = [...new Set(inventory.flatMap((entry) => entry.noticeFiles))]
    .sort()
    .map(fileDigest);
  // These are upstream package declarations, not a proof of every statically
  // linked component. Retain their bytes and exact versions for reconciliation.
  const bundledComponentVersionDeclarations = (scanNativeFiles ? inventory : [])
    .filter((entry) => entry.name.startsWith('@img/sharp-libvips-'))
    .flatMap((entry) => {
      const declarations = new Map();
      for (const location of entry.locations) {
        const path = join(location, 'versions.json');
        const actualPath = realpathSync(join(appRoot, path));
        if (declarations.has(actualPath)) continue;
        const proof = fileDigest(path);
        const versions = JSON.parse(readFileSync(actualPath, 'utf8'));
        if (
          !versions || typeof versions !== 'object' || Array.isArray(versions) ||
          !Object.keys(versions).length ||
          Object.entries(versions).some(([name, version]) =>
            !name.trim() || typeof version !== 'string' || !version.trim())
        ) {
          throw new Error('Sharp/libvips component version declaration is invalid');
        }
        declarations.set(actualPath, { package: `${entry.name}@${entry.version}`, ...proof, versions });
      }
      return [...declarations.values()];
    });
  return {
    packageCount: inventory.length,
    missingNoticeCount: missing.length,
    missingLicenseMetadataCount: withoutLicenseMetadata.length,
    nativeFileCount: allNativeFiles.length,
    noticeDigests,
    nativeFileDigests: allNativeFiles.map((file) => fileDigest(file.path)),
    bundledComponentVersionDeclarations,
    declaredNativeProvenance,
    unattributedNativeFiles: allNativeFiles.filter((file) => !attributedNativePaths.has(file.path)),
    packages: inventory
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = process.argv[2] ?? '/app';
    if (root.startsWith('--')) {
      throw new Error('expected an application root path');
    }
    const result = inventoryRuntimePackages(root);
    const imageIdIndex = process.argv.indexOf('--image-id');
    if (imageIdIndex !== -1) {
      const imageId = process.argv[imageIdIndex + 1];
      if (!/^sha256:[a-f0-9]{64}$/.test(imageId ?? '')) {
        throw new Error('expected an immutable image ID');
      }
      result.imageId = imageId;
    }
    console.log(JSON.stringify(result, null, 2));
    if (
      process.argv.includes('--strict') &&
      (result.missingNoticeCount > 0 ||
        result.missingLicenseMetadataCount > 0 ||
        result.unattributedNativeFiles.length > 0)
    ) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`runtime license audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}
