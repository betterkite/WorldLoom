#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '6.19.3';
const LICENSE_SHA256 = 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4';
const digest = (contents) => createHash('sha256').update(contents).digest('hex');

function oneSlot(directory, prefix) {
  const slots = readdirSync(directory).filter((name) => name.startsWith(prefix));
  if (slots.length !== 1) throw new Error(`expected one ${prefix} pnpm slot, found ${slots.length}`);
  return slots[0];
}

/** Bind the shipped generated-client engine to the exact installed Prisma engine. */
export function stagePrismaEngineProvenance(buildRoot, standaloneRoot) {
  const sourceRoot = resolve(buildRoot);
  const artifactRoot = resolve(standaloneRoot);
  const sourceStore = join(sourceRoot, 'node_modules/.pnpm');
  const artifactStore = join(artifactRoot, 'node_modules/.pnpm');
  const sourceSlot = oneSlot(sourceStore, `@prisma+engines@${VERSION}`);
  const clientSlot = oneSlot(artifactStore, `@prisma+client@${VERSION}`);
  const sourceDirectory = join(sourceStore, sourceSlot, 'node_modules/@prisma/engines');
  const clientDirectory = join(artifactStore, clientSlot, 'node_modules/.prisma/client');
  const metadata = JSON.parse(readFileSync(join(sourceDirectory, 'package.json'), 'utf8'));
  const generated = JSON.parse(readFileSync(join(clientDirectory, 'package.json'), 'utf8'));
  if (metadata.name !== '@prisma/engines' || metadata.version !== VERSION || metadata.license !== 'Apache-2.0') {
    throw new Error('Prisma engine source package identity or license changed');
  }
  if (generated.version !== VERSION) throw new Error('generated Prisma Client version changed');

  const engineNames = readdirSync(clientDirectory).filter((name) => /^libquery_engine-(?:linux-arm64|debian)-openssl-3\.0\.x\.so\.node$/.test(name));
  if (engineNames.length !== 1) throw new Error(`expected one generated Prisma engine, found ${engineNames.length}`);
  const engineName = engineNames[0];
  const originalEngine = join(sourceDirectory, engineName);
  const shippedEngine = join(clientDirectory, engineName);
  const engineSha256 = digest(readFileSync(shippedEngine));
  if (digest(readFileSync(originalEngine)) !== engineSha256) {
    throw new Error('generated Prisma engine differs from exact-version source package');
  }

  const originalLicense = join(sourceDirectory, 'LICENSE');
  const licenseContents = readFileSync(originalLicense);
  if (digest(licenseContents) !== LICENSE_SHA256) {
    throw new Error('Prisma engine source license digest changed');
  }
  const shippedLicense = join(clientDirectory, 'LICENSE.prisma-engines');
  if (existsSync(shippedLicense)) {
    if (digest(readFileSync(shippedLicense)) !== digest(licenseContents)) {
      throw new Error('generated Prisma engine license differs from source package');
    }
  } else {
    copyFileSync(originalLicense, shippedLicense);
  }

  const manifest = {
    schemaVersion: 1,
    sourcePackage: '@prisma/engines',
    sourceVersion: VERSION,
    sourceLicense: 'Apache-2.0',
    generatedClientVersion: VERSION,
    enginePath: relative(artifactRoot, shippedEngine),
    engineSha256,
    licensePath: relative(artifactRoot, shippedLicense),
    licenseSha256: digest(licenseContents)
  };
  const evidenceDirectory = join(artifactRoot, 'third_party');
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(join(evidenceDirectory, 'prisma-engine-provenance.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [buildRoot, standaloneRoot] = process.argv.slice(2);
    if (!buildRoot || !standaloneRoot) throw new Error('expected build and standalone paths');
    console.log(JSON.stringify(stagePrismaEngineProvenance(buildRoot, standaloneRoot)));
  } catch (error) {
    console.error(`Prisma engine provenance staging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
