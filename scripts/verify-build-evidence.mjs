#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { packageUrl, sbomTarget } from './generate-sbom.mjs';
import { auditBundledFonts } from './font-assets-audit.mjs';
import { reconcileRuntimePackages } from './reconcile-runtime-sbom.mjs';

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
const target = sbomTarget(args.includes('--role') ? requiredOption('--role') : 'application');
const sbomPath = requiredOption('--sbom');
const imagePath = requiredOption('--image');
const outputPath = requiredOption('--output');
const runtimeInventoryPath = args.includes('--runtime-inventory')
  ? requiredOption('--runtime-inventory')
  : null;
const vulnerabilityReportPath = args.includes('--vulnerability-report')
  ? requiredOption('--vulnerability-report')
  : null;
const provenanceIndex = args.includes('--provenance') ? requiredOption('--provenance') : null;
const provenanceArtifactPath = args.includes('--provenance-artifact')
  ? requiredOption('--provenance-artifact')
  : null;
const sbomProvenanceIndex = args.includes('--sbom-provenance')
  ? requiredOption('--sbom-provenance')
  : null;
if (provenanceIndex && !provenanceArtifactPath) {
  throw new Error('--provenance-artifact is required with --provenance');
}
if (sbomProvenanceIndex && !provenanceArtifactPath) {
  throw new Error('--provenance-artifact is required with --sbom-provenance');
}
const sbom = readJson(sbomPath);
const image = Array.isArray(readJson(imagePath)) ? readJson(imagePath)[0] : readJson(imagePath);
const sourceRevision = sbom.metadata?.component?.properties?.find(
  (property) => property.name === 'worldloom:source-revision'
)?.value;
const sourceProperties = new Map(
  (sbom.metadata?.component?.properties ?? []).map((property) => [property.name, property.value])
);
const sourceTreeSha256 = sourceProperties.get('worldloom:source-tree-sha256');
const labels = image.Config?.Labels ?? {};

if (sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.5') {
  throw new Error('SBOM is not CycloneDX 1.5');
}
if (!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sbom.serialNumber ?? '')) {
  throw new Error('SBOM serial number is not an RFC-4122 UUID URN');
}
if (sourceProperties.get('worldloom:source-worktree-state') !== 'clean') {
  throw new Error('release evidence requires an SBOM from a clean source checkout');
}
if (typeof sourceTreeSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sourceTreeSha256)) {
  throw new Error('SBOM source tree digest is missing or invalid');
}
if (sourceRevision !== revision) {
  throw new Error(`SBOM source revision mismatch: ${sourceRevision ?? 'missing'} != ${revision}`);
}
if (sourceProperties.get('worldloom:artifact-role') !== target.role ||
    sourceProperties.get('worldloom:lockfile-path') !== target.lockfilePath) {
  throw new Error('SBOM artifact role or lockfile path mismatch');
}
const lockfileSha256 = sha256(target.lockfilePath);
if (sourceProperties.get('worldloom:pnpm-lock-sha256') !== lockfileSha256) {
  throw new Error('SBOM lockfile digest mismatch with checkout ' + target.lockfilePath);
}
if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
  throw new Error('SBOM has no production dependency components');
}
const fontManifest = target.role === 'application' ? auditBundledFonts(process.cwd()).manifest : null;
const fontComponents = sbom.components.filter((component) => component.type === 'file');
if (target.role === 'application' && (fontComponents.length !== 28 || new Set(fontComponents.map((value) => value.name)).size !== 28)) {
  throw new Error('SBOM bundled font coverage is incomplete or duplicated');
}
if (target.role === 'migration') {
  const metadata = readJson(target.packagePath);
  if (sbom.metadata.component.name !== metadata.name || sbom.metadata.component.version !== metadata.version ||
      sbom.components.some((component) => component.type !== 'library')) {
    throw new Error('migration SBOM contains the wrong root or non-npm components');
  }
  if (!runtimeInventoryPath) throw new Error('migration evidence requires runtime inventory');
}
for (const component of [sbom.metadata.component, ...sbom.components]) {
  if (component.type === 'file') {
    const asset = fontManifest.assets.find((value) => value.file === component.name);
    const family = fontManifest.families.find((value) => value.family === asset?.family);
    const properties = new Map((component.properties ?? []).map((value) => [value.name, value.value]));
    if (
      !asset || !family || component.version !== family.version ||
      component['bom-ref'] !== `urn:worldloom:font:${asset.file}:${asset.sha256}` ||
      component.hashes?.length !== 1 || component.hashes[0].alg !== 'SHA-256' ||
      component.hashes[0].content !== asset.sha256 ||
      component.licenses?.length !== 1 || component.licenses[0].license?.id !== 'OFL-1.1' ||
      component.copyright !== family.copyright ||
      properties.get('worldloom:font-family') !== family.family ||
      properties.get('worldloom:font-license-file') !== `public/fonts/${family.licenseFile}` ||
      properties.get('worldloom:font-license-sha256') !== family.licenseSha256 ||
      !component.externalReferences?.some((value) => value.type === 'distribution' && value.url === asset.source) ||
      !sbom.dependencies?.find((value) => value.ref === sbom.metadata.component['bom-ref'])?.dependsOn?.includes(component['bom-ref'])
    ) {
      throw new Error('SBOM bundled font source, bytes or license is invalid');
    }
    continue;
  }
  if (!component.name || !component.version || component.purl !== packageUrl(component.name, component.version) || component['bom-ref'] !== component.purl) {
    throw new Error('SBOM component has an invalid npm Package URL');
  }
}
if (!/^sha256:[a-f0-9]{64}$/.test(image.Id ?? '')) throw new Error('image has no immutable ID');
if (labels['org.opencontainers.image.revision'] !== revision) {
  throw new Error(
    `image revision mismatch: ${labels['org.opencontainers.image.revision'] ?? 'missing'} != ${revision}`
  );
}
if (labels['org.opencontainers.image.title'] !== target.imageTitle) {
  throw new Error('image title does not match ' + target.imageTitle);
}

let runtimePackages = { status: 'PENDING', scope: 'Application runtime npm package identities' };
if (runtimeInventoryPath) {
  const inventory = readJson(runtimeInventoryPath);
  if (inventory.imageId !== image.Id || !/^sha256:[a-f0-9]{64}$/.test(inventory.imageId ?? '')) {
    throw new Error('runtime inventory image identity mismatch');
  }
  runtimePackages = {
    ...reconcileRuntimePackages(sbom, inventory),
    imageId: inventory.imageId,
    inventorySha256: sha256(runtimeInventoryPath)
  };
  if (target.role === 'migration' && runtimePackages.sourceOnlyPackageCount !== 0) {
    throw new Error('migration SBOM and runtime package sets differ');
  }
}

let vulnerabilityScan = null;
if (vulnerabilityReportPath) {
  const report = readJson(vulnerabilityReportPath);
  if (!Array.isArray(report.Results)) {
    throw new Error('Trivy report has no Results array');
  }
  const vulnerabilities = report.Results.flatMap((result) => result.Vulnerabilities ?? []);
  const critical = vulnerabilities.filter((item) => item.Severity === 'CRITICAL').length;
  const high = vulnerabilities.filter((item) => item.Severity === 'HIGH').length;
  if (critical > 0 || high > 0) {
    throw new Error(`Trivy report contains HIGH/CRITICAL findings: ${high} high, ${critical} critical`);
  }
  vulnerabilityScan = {
    status: 'PASS',
    scanner: 'Trivy',
    policy: 'CRITICAL,HIGH; fixed and unfixed findings block the build',
    results: report.Results.length,
    vulnerabilities: vulnerabilities.length,
    high,
    critical,
    reportSha256: sha256(vulnerabilityReportPath)
  };
}

let provenance = null;
let sbomProvenance = null;
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
if (sbomProvenanceIndex) {
  sbomProvenance = readJson(sbomProvenanceIndex);
  if (!Array.isArray(sbomProvenance) || sbomProvenance.length === 0) {
    throw new Error('signed SBOM attestation verification returned no attestations');
  }
  const verified = sbomProvenance[0]?.verificationResult;
  const predicateType = verified?.statement?.predicateType;
  if (predicateType !== 'https://cyclonedx.org/bom' && !predicateType?.startsWith('https://cyclonedx.org/bom/')) {
    throw new Error('signed SBOM attestation is not a CycloneDX predicate');
  }
  const archiveDigest = sha256(provenanceArtifactPath);
  const attestedDigest = verified.statement.subject?.[0]?.digest?.sha256;
  if (attestedDigest !== archiveDigest) {
    throw new Error(`signed SBOM subject mismatch: ${attestedDigest ?? 'missing'} != ${archiveDigest}`);
  }
  // gh verifies the signature and archive subject upstream. Correlating only
  // that subject would still allow a different SBOM for the same archive.
  if (!isDeepStrictEqual(verified.statement.predicate, sbom)) {
    throw new Error('signed SBOM predicate does not match the supplied SBOM');
  }
}

const evidence = {
  schemaVersion: 1,
  artifactRole: target.role,
  evidenceId: 'EV-01',
  status: 'CONDITIONAL',
  level: 'E1',
  sourceRevision: revision,
  sourceTreeSha256,
  ci: {
    repository: process.env.GITHUB_REPOSITORY ?? 'local',
    runId: process.env.GITHUB_RUN_ID ?? null,
    workflow: process.env.GITHUB_WORKFLOW ?? null
  },
  sbom: {
    format: `${sbom.bomFormat} ${sbom.specVersion}`,
    components: sbom.components.length,
    lockfileSha256,
    lockfilePath: target.lockfilePath,
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
  runtimePackages,
  vulnerabilityScan: vulnerabilityScan ?? {
    status: 'PENDING',
    scanner: null
  },
  provenance: provenance
    ? {
        status: 'PASS',
        verification: 'gh attestation verify',
        predicateType: provenance[0].verificationResult.statement.predicateType,
        subjectCount: provenance[0].verificationResult.statement.subject.length,
        verificationSha256: sha256(provenanceIndex),
        imageArchiveSha256: sha256(provenanceArtifactPath),
        sbomAttestation: sbomProvenance
          ? {
              status: 'PASS',
              verification: 'gh attestation verify',
              predicateType: sbomProvenance[0].verificationResult.statement.predicateType,
              verificationSha256: sha256(sbomProvenanceIndex)
            }
          : {
              status: 'PENDING',
              verification: null
            }
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
