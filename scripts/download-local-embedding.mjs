#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, rename, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { env, LogLevel, pipeline } from '@huggingface/transformers';
import config from '../config/llm.json' with { type: 'json' };

const execFileAsync = promisify(execFile);
const local = config.localEmbeddings;
if (!local?.enabled) {
  console.error('Local embeddings are disabled in config/llm.json');
  process.exit(1);
}

const cacheDir = resolve(process.cwd(), local.cacheDir);
const modelDir = resolve(cacheDir, local.model);
const modelFiles = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'sentencepiece.bpe.model',
  'onnx/model_int8.onnx'
];
const modelUrl = (file) => {
  const modelPath = local.model.split('/').map(encodeURIComponent).join('/');
  const filePath = file.split('/').map(encodeURIComponent).join('/');
  return `https://huggingface.co/${modelPath}/resolve/main/${filePath}`;
};

async function isPresent(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

async function downloadWithCurl(url, target) {
  const temporary = `${target}.partial`;
  await execFileAsync(
    'curl',
    [
      '--fail',
      '--location',
      '--retry',
      '3',
      '--retry-delay',
      '2',
      '--ipv4',
      '--silent',
      '--show-error',
      url,
      '--output',
      temporary
    ],
    { maxBuffer: 1024 * 1024 }
  );
  await rename(temporary, target);
}

await mkdir(modelDir, { recursive: true });
env.logLevel = LogLevel.ERROR;
console.log(`Preparing local embedding model ${local.model} (${local.dtype})...`);

for (const file of modelFiles) {
  const target = resolve(modelDir, file);
  if (await isPresent(target)) {
    console.log(`  cached ${file}`);
    continue;
  }
  await mkdir(resolve(target, '..'), { recursive: true });
  console.log(`  downloading ${file}`);
  try {
    await downloadWithCurl(modelUrl(file), target);
  } catch (error) {
    console.error(`Failed to download ${file}: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exit(1);
  }
}

await pipeline('feature-extraction', modelDir, {
  dtype: local.dtype,
  cache_dir: cacheDir,
  local_files_only: true
});
console.log(`Local embedding model ready in ${modelDir}`);
