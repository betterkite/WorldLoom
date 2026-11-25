#!/usr/bin/env node

import { closeSync, constants, fstatSync, openSync, readSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { evaluateLocalDeployment, LOCAL_DEPLOYMENT_FACTS } from './local-preflight-contract.mjs';

// Independent local applicability gate; never invoke or weaken production --strict.
const args = process.argv.slice(2).filter((value) => value !== '--');
let composePath;
let json = false;
for (let index = 0; index < args.length; index += 1) {
  const option = args[index];
  if (option === '--json' && !json) json = true;
  else if (option === '--compose-config' && composePath === undefined &&
      args[index + 1] && !args[index + 1].startsWith('--')) composePath = args[++index];
  else {
    console.error('Expected --compose-config <resolved-json-file> and optional --json; no developer or --strict fallback.');
    process.exit(2);
  }
}
if (!composePath || process.env.WORLDLOOM_PREFLIGHT_STRICT === 'true') {
  console.error('Explicit resolved Compose JSON is required; production strict cannot be combined with this local-only gate.');
  process.exit(2);
}

function readJson(path, maxBytes) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const file = fstatSync(descriptor);
    if (!file.isFile() || file.size <= 0 || file.size > maxBytes) throw new Error();
    // Bound actual bytes, not only a stat taken before a file could grow.
    const bytes = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < bytes.length) {
      const length = readSync(descriptor, bytes, size, bytes.length - size, null);
      if (length === 0) break;
      size += length;
    }
    if (size > maxBytes) throw new Error();
    return JSON.parse(bytes.toString('utf8', 0, size));
  } finally {
    closeSync(descriptor);
  }
}

let compose;
let config;
try {
  // Resolved Compose may contain secrets. Read only the explicitly chosen file,
  // never output it, and never load implicit .env/.env.local or shell templates.
  compose = readJson(resolve(composePath), 2 * 1024 * 1024);
  config = readJson(resolve('config/llm.json'), 1024 * 1024);
} catch {
  console.error('Local preflight input must be readable bounded regular JSON files; paths and contents withheld.');
  process.exit(2);
}

const local = config?.localEmbeddings;
const relative = (value) => typeof value === 'string' && value !== '' &&
  !isAbsolute(value) && !value.split(/[\\/]/).includes('..');
const expectedCacheSource = relative(local?.cacheDir) ? resolve(local.cacheDir) : undefined;
// Default filenames follow the installed Transformers dtype suffix mapping.
// Presence is not model loading/inference proof; custom/external-data layouts
// still need their independent runtime evidence.
const modelFileByDtype = {
  fp32: 'model.onnx', fp16: 'model_fp16.onnx', int8: 'model_int8.onnx',
  uint8: 'model_uint8.onnx', q8: 'model_quantized.onnx', q4: 'model_q4.onnx'
};
const dtype = local?.dtype === undefined ? 'q8' : local.dtype;
const modelFile = Object.hasOwn(modelFileByDtype, dtype) ? modelFileByDtype[dtype] : undefined;
let localFilesPresent = false;
if (expectedCacheSource && relative(local?.model) && modelFile) {
  const modelRoot = resolve(expectedCacheSource, local.model);
  localFilesPresent = ['config.json', 'tokenizer.json', 'tokenizer_config.json', `onnx/${modelFile}`]
    .every((file) => {
      try {
        const metadata = statSync(resolve(modelRoot, file));
        return metadata.isFile() && metadata.size > 0;
      } catch {
        return false;
      }
    });
}
const facts = Object.fromEntries(LOCAL_DEPLOYMENT_FACTS.map(([name]) => [name, process.env[name]]));
const report = evaluateLocalDeployment({ compose, config, facts, localFilesPresent, expectedCacheSource });
if (json) console.log(JSON.stringify(report, null, 2));
else {
  console.log('WorldLoom local single-user preflight (uncapped; offline declarations only)');
  for (const item of report.checks) console.log(`${item.status.padEnd(4)} ${item.id}: ${item.message}`);
  console.log(report.passed
    ? 'Local declaration checks passed; this is not release approval or runtime evidence.'
    : 'Local preflight failed; unresolved configuration or evidence declarations block local release.');
}
if (!report.passed) process.exitCode = 1;
