#!/usr/bin/env node

import { cpSync, existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export function prepareOnnxRuntime(source, destination, targetArch) {
  const architecture = { arm64: 'arm64', amd64: 'x64' }[targetArch];
  if (!architecture) throw new Error(`unsupported ONNX runtime target architecture: ${targetArch}`);
  const sourceRoot = realpathSync(resolve(source));
  const destinationRoot = resolve(destination);
  if (destinationRoot === sourceRoot || destinationRoot.startsWith(sourceRoot + sep)) {
    throw new Error('ONNX runtime destination must be outside its source package');
  }
  if (existsSync(destinationRoot)) throw new Error('ONNX runtime destination already exists');

  const metadata = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8'));
  if (metadata.name !== 'onnxruntime-node' || metadata.version !== '1.30.0') {
    throw new Error('ONNX runtime source package does not match the locked version');
  }
  const platform = join(sourceRoot, 'bin', 'napi-v6', 'linux', architecture);
  if (!existsSync(platform)) throw new Error(`ONNX runtime platform payload is missing: ${architecture}`);

  cpSync(sourceRoot, destinationRoot, {
    recursive: true,
    filter(path) {
      if (lstatSync(path).isSymbolicLink()) {
        throw new Error('ONNX runtime source package contains a symbolic link');
      }
      const parts = relative(sourceRoot, path).split(sep);
      if (parts[0] !== 'bin' || parts.length <= 2) return true;
      if (parts[1] !== 'napi-v6') return true;
      if (parts[2] !== 'linux') return false;
      if (parts.length <= 3) return true;
      return parts[3] === architecture;
    }
  });
  return { package: `${metadata.name}@${metadata.version}`, platform: `linux/${architecture}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [source, destination, targetArch] = process.argv.slice(2);
    if (!source || !destination || !targetArch) {
      throw new Error('expected source package, destination and Docker target architecture');
    }
    console.log(JSON.stringify(prepareOnnxRuntime(source, destination, targetArch)));
  } catch (error) {
    console.error(`ONNX runtime preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
