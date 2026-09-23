#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);

function requiredOption(name) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  throw new Error(`${name} is required`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const revision = requiredOption('--revision');
const sbomPath = requiredOption('--sbom');
const imagePath = requiredOption('--image');
const outputPath = requiredOption('--output');
const provenanceIndex = args.includes('--provenance') ? requiredOption('--provenance') : null;
const provenanceArtifactPath = args.includes('--provenance-artifact')
  ? requiredOption('--provenance-artifact')
  : null;
if (provenanceIndex && !provenanceArtifactPath) {
  throw new Error('--provenance-artifact is required with --provenance');
}
const sbom = readJson(sbomPath);
const image = Array.isArray(readJson(imagePath)) ? readJson(imagePath)[0] : readJson(imagePath);
const sourceRevision = sbom.metadata?.component?.properties?.find(
  (property) => property.name === 'worldloom:source-revision'
)?.value;
const labels = image.Config?.Labels ?? {};

if (sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.5') {
  throw new Error('SBOM is not CycloneDX 1.5');
}
if (sourceRevision !== revision) {
  throw new Error(`SBOM source revision mismatch: ${sourceRevision ?? 'missing'} != ${revision}`);
}
if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
  throw new Error('SBOM has no production dependency components');
}
if (!String(image.Id ?? '').startsWith('sha256:')) throw new Error('image has no immutable ID');
if (labels['org.opencontainers.image.revision'] !== revision) {
  throw new Error(
    `image revision mismatch: ${labels['org.opencontainers.image.revision'] ?? 'missing'} != ${revision}`
  );
}
if (labels['org.opencontainers.image.title'] !== 'WorldLoom') {
  throw new Error('image title is not WorldLoom');
}

let provenance = null;
if (provenanceIndex) {
  provenance = readJson(provenanceIndex);
  if (!Array.isArray(provenance) || provenance.length === 0) {
    throw new Error('signed provenance verification returned no attestations');
  }
  const verified = provenance[0]?.verificationResult;
  if (verified?.statement?.predicateType !== 'https://slsa.dev/provenance/v1') {
    throw new Error('signed provenance is not SLSA v1 build provenance');
  }
  if (!Array.isArray(verified.statement.subject) || verified.statement.subject.length === 0) {
    throw new Error('signed provenance has no subject');
  }
  const archiveDigest = sha256(provenanceArtifactPath);
  const attestedDigest = verified.statement.subject[0]?.digest?.sha256;
  if (attestedDigest !== archiveDigest) {
    throw new Error(`signed provenance subject mismatch: ${attestedDigest ?? 'missing'} != ${archiveDigest}`);
  }
}

const evidence = {
  schemaVersion: 1,
  evidenceId: 'EV-01',
  status: 'CONDITIONAL',
  level: 'E1',
  sourceRevision: revision,
  ci: {
    repository: process.env.GITHUB_REPOSITORY ?? 'local',
    runId: process.env.GITHUB_RUN_ID ?? null,
    workflow: process.env.GITHUB_WORKFLOW ?? null
  },
  sbom: {
    format: `${sbom.bomFormat} ${sbom.specVersion}`,
    components: sbom.components.length,
    sha256: sha256(sbomPath)
  },
  image: {
    id: image.Id,
    inspectSha256: sha256(imagePath),
    title: labels['org.opencontainers.image.title'],
    source: labels['org.opencontainers.image.source'],
    revision: labels['org.opencontainers.image.revision'],
    created: labels['org.opencontainers.image.created'],
    version: labels['org.opencontainers.image.version']
  },
  provenance: provenance
    ? {
        status: 'PASS',
        verification: 'gh attestation verify',
        predicateType: provenance[0].verificationResult.statement.predicateType,
        subjectCount: provenance[0].verificationResult.statement.subject.length,
        verificationSha256: sha256(provenanceIndex),
        imageArchiveSha256: sha256(provenanceArtifactPath)
      }
    : {
        status: 'PENDING',
        verification: null
      },
  limitations: [
    'This index correlates source, SBOM, and image metadata at CI E1 level.',
    'Registry digest verification, vulnerability exceptions, and independent review remain deployment evidence.'
  ]
};

writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
