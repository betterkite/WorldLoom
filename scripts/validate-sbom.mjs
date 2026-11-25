#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import addInternationalFormats from 'ajv-formats-draft2019';

const run = promisify(execFile);

export const schemaSources = [
  { name: 'bom-1.5.schema.json', sha256: '067f7824b08653839ea050ae9e09ca48375eadc2652b0e2a299476e7db90335b' },
  { name: 'spdx.schema.json', sha256: '4f6e2b05c05d26a4f2dc5879fbc2fca94b0a28db46289d0c51345621b71cfbfc' },
  { name: 'jsf-0.82.schema.json', sha256: '8bae002c25e723db7ee1f26afde680ae1a2b1a8f6b4b4b0fd65dc3becb090aae' }
].map((source) => ({
  ...source,
  url: `https://raw.githubusercontent.com/CycloneDX/specification/1.5/schema/${source.name}`
}));

export function verifySchemaBytes(source, bytes) {
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) {
    throw new Error(`upstream schema digest mismatch: ${source.name}`);
  }
  const schema = JSON.parse(bytes.toString('utf8'));
  if (schema.$id !== `http://cyclonedx.org/schema/${source.name}`) {
    throw new Error(`unexpected upstream schema ID: ${source.name}`);
  }
  return schema;
}

async function fetchSchema(source) {
  // Use the OS HTTPS client so workstation and CI trust/proxy settings are respected.
  // URL and expected bytes are fixed here; no arbitrary URL or shell interpolation is used.
  const { stdout } = await run('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '20', '--retry', '1', source.url], {
    timeout: 45_000,
    maxBuffer: 2 * 1024 * 1024
  });
  return verifySchemaBytes(source, Buffer.from(stdout));
}

export function validateSbom(document, schemas) {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
  addFormats(ajv);
  addInternationalFormats(ajv);
  for (const schema of schemas) ajv.addSchema(schema);
  const validate = ajv.getSchema('http://cyclonedx.org/schema/bom-1.5.schema.json');
  if (!validate) throw new Error('CycloneDX 1.5 schema was not loaded');
  const valid = validate(document);
  return {
    status: valid ? 'PASS' : 'FAIL',
    standard: 'CycloneDX 1.5 JSON schema',
    schemas: schemaSources,
    errors: (validate.errors ?? []).map((error) => ({
      path: error.instancePath,
      rule: error.keyword,
      message: error.message
    }))
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2).filter((arg) => arg !== '--');
    const path = args[0] ?? 'artifacts/worldloom-sbom.cdx.json';
    const document = JSON.parse(readFileSync(path, 'utf8'));
    const schemas = await Promise.all(schemaSources.map(fetchSchema));
    const report = validateSbom(document, schemas);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'PASS') process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ status: 'FAIL', standard: 'CycloneDX 1.5 JSON schema', schemas: schemaSources, error: error.message }, null, 2));
    console.error('SBOM validation failed: ' + error.message);
    process.exitCode = 1;
  }
}
