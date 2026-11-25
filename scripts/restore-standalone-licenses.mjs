#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inventoryRuntimePackages } from './runtime-license-audit.mjs';

function digest(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

const noticeFilename = /^(?:licen[sc]e|copying|notice)(?:[._-]|$)/i;

function requireInRoot(root, path) {
  const actual = realpathSync(path);
  if (actual !== root && !actual.startsWith(root + sep)) {
    throw new Error('vendored source or destination escapes its package root');
  }
  return actual;
}

export function restoreStandaloneLicenses(source, artifact) {
  const sourceRoot = realpathSync(resolve(source));
  const artifactRoot = realpathSync(resolve(artifact));
  if (sourceRoot === artifactRoot) throw new Error('source and artifact roots must differ');

  const sourcePackages = new Map(
    inventoryRuntimePackages(sourceRoot, { scanNativeFiles: false }).packages.map((entry) => [
      `${entry.name}@${entry.version}`,
      entry
    ])
  );
  const targetPackages = inventoryRuntimePackages(artifactRoot, { scanNativeFiles: false }).packages;
  const unresolved = [];
  const copyPlan = new Map();
  const restoredPackages = new Set();
  const restoredVendoredComponents = new Set();
  const vendoredComponents = [];
  const seenVendoredRoots = new Set();
  const restoredDeclarations = new Set();
  const componentVersionDeclarations = [];

  function planNotice(original, destination, key, restored = restoredPackages) {
    requireInRoot(sourceRoot, original);
    if (!lstatSync(original).isFile()) throw new Error('source notice is not a regular file');
    const contents = readFileSync(original);
    if (!contents.length) throw new Error('source notice is empty');
    const sha256 = digest(contents);
    requireInRoot(artifactRoot, join(destination, '..'));
    let status;
    try {
      status = lstatSync(destination);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (status) {
      if (!status.isFile()) throw new Error(`artifact notice path is not a regular file: ${key}`);
      if (digest(readFileSync(destination)) !== sha256) {
        throw new Error(`artifact notice differs from exact-version source: ${key}`);
      }
    } else {
      const previous = copyPlan.get(destination);
      if (previous && previous.sha256 !== sha256) throw new Error('conflicting notice copy plan');
      copyPlan.set(destination, { original, destination, sha256 });
      restored.add(key);
    }
    return { filename: basename(destination), sha256 };
  }

  function planNextVendored(original, target, key) {
    const sourcePackage = realpathSync(join(sourceRoot, original.locations[0]));
    const sourceCompiled = join(sourcePackage, 'dist/compiled');
    for (const location of target.locations) {
      const targetPackage = realpathSync(join(artifactRoot, location));
      const compiled = join(targetPackage, 'dist/compiled');
      if (!existsSync(compiled)) continue;
      if (!lstatSync(compiled).isDirectory()) throw new Error('vendored destination is not a directory');
      requireInRoot(targetPackage, compiled);
      if (seenVendoredRoots.has(compiled)) continue;
      seenVendoredRoots.add(compiled);
      if (!existsSync(sourceCompiled) || !lstatSync(sourceCompiled).isDirectory()) {
        throw new Error('exact-version source lacks the traced vendored directory');
      }
      requireInRoot(sourcePackage, sourceCompiled);
      const components = [];
      for (const name of readdirSync(compiled).sort()) {
        const directory = join(compiled, name);
        if (lstatSync(directory).isFile()) continue;
        if (!lstatSync(directory).isDirectory()) throw new Error('vendored component must not be a symlink');
        const children = readdirSync(directory).sort();
        // A namespace is a container, not one software package. Retain ordinary
        // file-bearing directories as a group rather than silently skipping files.
        if (name.startsWith('@') && children.length && children.every((child) =>
          lstatSync(join(directory, child)).isDirectory())) {
          components.push(...children.map((child) => join(name, child)));
        } else components.push(name);
      }
      for (const component of components) {
        const directory = join(compiled, component);
        if (lstatSync(directory).isFile()) continue;
        if (!lstatSync(directory).isDirectory()) throw new Error('vendored component must not be a symlink');
        const sourceDirectory = join(sourceCompiled, component);
        let sourceAncestor = sourceCompiled;
        for (const segment of component.split(sep)) {
          sourceAncestor = join(sourceAncestor, segment);
          if (lstatSync(sourceAncestor).isSymbolicLink()) throw new Error('vendored source must not be a symlink');
        }
        if (!existsSync(sourceDirectory) || !lstatSync(sourceDirectory).isDirectory()) {
          throw new Error('exact-version source lacks a traced vendored component');
        }
        requireInRoot(sourcePackage, sourceDirectory);
        const verifiedFiles = [];
        const payloadDirectories = [];
        function verifyFiles(current) {
          const before = verifiedFiles.length;
          for (const name of readdirSync(current).sort()) {
            const path = join(current, name);
            const stat = lstatSync(path);
            if (stat.isDirectory()) {
              requireInRoot(directory, path);
              verifyFiles(path);
            } else if (stat.isFile()) {
              if (noticeFilename.test(name)) continue;
              const within = relative(directory, path);
              const sourceFile = join(sourceDirectory, within);
              // Reject every symlink component before reading the exact source.
              let checked = sourceDirectory;
              for (const segment of within.split(sep)) {
                checked = join(checked, segment);
                if (lstatSync(checked).isSymbolicLink()) throw new Error('vendored source must not be a symlink');
              }
              requireInRoot(sourceDirectory, sourceFile);
              if (!lstatSync(sourceFile).isFile()) throw new Error('vendored source is not a regular file');
              const sha256 = digest(readFileSync(path));
              if (digest(readFileSync(sourceFile)) !== sha256) {
                throw new Error('traced vendored bytes differ from the exact parent package');
              }
              verifiedFiles.push({ path: within, sha256 });
            } else throw new Error('vendored destination must not be a symlink');
          }
          if (verifiedFiles.length > before) payloadDirectories.push(current);
        }
        verifyFiles(directory);
        if (!verifiedFiles.length) continue;
        const notices = [];
        for (const targetDirectory of payloadDirectories) {
          const originalDirectory = join(sourceDirectory, relative(directory, targetDirectory));
          for (const filename of readdirSync(originalDirectory).filter((name) => noticeFilename.test(name)).sort()) {
            const path = join(originalDirectory, filename);
            if (!lstatSync(path).isFile()) throw new Error('vendored source notice must be a regular file');
            if (!readFileSync(path).length) continue;
            const destination = join(targetDirectory, filename);
            notices.push({
              ...planNotice(path, destination, `${key}:${component}`, restoredVendoredComponents),
              path: relative(directory, destination)
            });
          }
        }
        vendoredComponents.push({
          parentPackage: key,
          location: relative(artifactRoot, directory),
          sourceLocation: relative(sourceRoot, sourceDirectory),
          verifiedFiles,
          notices,
          unresolved: notices.length === 0 ? 'no notice in exact-version vendored source' : null
        });
      }
    }
  }

  function planSharpVersions(original, target, key) {
    const sources = [...new Set(original.locations.map((location) =>
      requireInRoot(sourceRoot, join(sourceRoot, location))))];
    const destinations = new Set(target.locations.map((location) =>
      requireInRoot(artifactRoot, join(artifactRoot, location))));
    for (const directory of destinations) {
      let declarationHash;
      for (const sourcePackage of sources) {
        const declaration = join(sourcePackage, 'versions.json');
        requireInRoot(sourcePackage, declaration);
        if (!lstatSync(declaration).isFile()) throw new Error('Sharp declaration must be a regular file');
        const contents = readFileSync(declaration);
        const versions = JSON.parse(contents.toString('utf8'));
        if (!versions || typeof versions !== 'object' || Array.isArray(versions) ||
          !Object.keys(versions).length || Object.entries(versions).some(([name, version]) =>
            !name.trim() || typeof version !== 'string' || !version.trim())) {
          throw new Error('Sharp/libvips component version declaration is invalid');
        }
        const sha256 = digest(contents);
        if (declarationHash && declarationHash !== sha256) throw new Error('conflicting Sharp source declarations');
        declarationHash = sha256;
        const verifiedFiles = [];
        function verifyTracedFiles(current) {
          for (const name of readdirSync(current).sort()) {
            const path = join(current, name);
            const status = lstatSync(path);
            if (status.isSymbolicLink()) throw new Error('Sharp traced evidence must not be a symlink');
            if (status.isDirectory()) {
              verifyTracedFiles(path);
            } else if (status.isFile()) {
              const within = relative(directory, path);
              if (within === 'versions.json' || noticeFilename.test(name)) continue;
              let sourceFile = sourcePackage;
              for (const segment of within.split(sep)) {
                sourceFile = join(sourceFile, segment);
                if (lstatSync(sourceFile).isSymbolicLink()) throw new Error('Sharp source evidence must not be a symlink');
              }
              requireInRoot(sourcePackage, sourceFile);
              if (!lstatSync(sourceFile).isFile()) throw new Error('Sharp source evidence must be a regular file');
              const fileHash = digest(readFileSync(path));
              if (digest(readFileSync(sourceFile)) !== fileHash) throw new Error('Sharp traced bytes differ from exact-version source');
              verifiedFiles.push({ path: within, sha256: fileHash });
            } else throw new Error('Sharp traced evidence must be a regular file');
          }
        }
        verifyTracedFiles(directory);
        planNotice(declaration, join(directory, 'versions.json'), key, restoredDeclarations);
        componentVersionDeclarations.push({
          package: key,
          location: relative(artifactRoot, join(directory, 'versions.json')),
          sourceLocation: relative(sourceRoot, declaration),
          sha256,
          verifiedFiles
        });
      }
    }
  }

  for (const target of targetPackages) {
    const key = `${target.name}@${target.version}`;
    const original = sourcePackages.get(key);
    if (!original) {
      if (target.name.startsWith('@img/sharp-libvips-')) throw new Error(`no exact-version Sharp source: ${key}`);
      unresolved.push({ package: key, reason: 'no notice in exact-version source install' });
      continue;
    }
    if (original.license !== target.license) {
      throw new Error(`artifact license metadata differs from exact-version source: ${key}`);
    }

    if (!original.noticeFiles.length) {
      unresolved.push({ package: key, reason: 'no notice in exact-version source install' });
    }
    const notices = new Map();
    for (const notice of original.noticeFiles) {
      const filename = basename(notice);
      const contents = readFileSync(join(sourceRoot, notice));
      const existing = notices.get(filename);
      if (existing && digest(existing.contents) !== digest(contents)) {
        throw new Error(`conflicting source notices for ${key}: ${filename}`);
      }
      notices.set(filename, { contents, path: join(sourceRoot, notice) });
    }

    const directories = new Set(target.locations.map((location) => realpathSync(join(artifactRoot, location))));
    for (const directory of directories) {
      for (const [filename, { path }] of notices) {
        planNotice(path, join(directory, filename), key);
      }
    }
    // Next's vendored metadata often omits child versions. Bind every traced
    // byte to the exact parent install; never invent a child version/license.
    if (target.name === 'next') planNextVendored(original, target, key);
    // Tracing may omit this upstream declaration even though it ships libvips.
    // Bind it to every traced byte; a package name/version alone is insufficient.
    if (target.name.startsWith('@img/sharp-libvips-')) planSharpVersions(original, target, key);
  }

  // A mismatched byte, conflicting notice or unsafe path must fail before any
  // top-level or vendored notice is copied into a distributable payload.
  for (const { original, destination } of copyPlan.values()) copyFileSync(original, destination);

  return {
    scannedPackageCount: targetPackages.length,
    restoredPackageCount: restoredPackages.size,
    copiedFileCount: copyPlan.size,
    unresolved,
    restoredDeclarationCount: restoredDeclarations.size,
    componentVersionDeclarations,
    restoredVendoredComponentCount: restoredVendoredComponents.size,
    vendoredComponents
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [source, artifact] = process.argv.slice(2);
    if (!source || !artifact) throw new Error('expected source root and standalone artifact root');
    console.log(JSON.stringify(restoreStandaloneLicenses(source, artifact), null, 2));
  } catch (error) {
    console.error(`standalone license restoration failed: ${error.message}`);
    process.exitCode = 1;
  }
}
