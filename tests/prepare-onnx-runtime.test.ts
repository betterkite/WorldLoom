import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { prepareOnnxRuntime } from '../scripts/prepare-onnx-runtime.mjs';

const temporaryRoots: string[] = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'worldloom-onnx-'));
  temporaryRoots.push(directory);
  const source = join(directory, 'source');
  const destination = join(directory, 'target');
  writeFileSync(join(directory, 'marker'), 'fixture');
  mkdirSync(source);
  writeFileSync(
    join(source, 'package.json'),
    JSON.stringify({ name: 'onnxruntime-node', version: '1.30.0' })
  );
  writeFileSync(join(source, 'README.md'), 'ONNX runtime');
  for (const platform of ['linux/arm64', 'linux/x64', 'darwin/arm64', 'win32/x64']) {
    const path = join(source, 'bin', 'napi-v6', platform);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'onnxruntime_binding.node'), platform);
  }
  return { source, destination };
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('target-platform ONNX package', () => {
  it.each([
    ['arm64', 'arm64'],
    ['amd64', 'x64']
  ])('retains only linux/%s payload', (targetArch, packageArch) => {
    const { source, destination } = fixture();
    expect(prepareOnnxRuntime(source, destination, targetArch)).toMatchObject({
      package: 'onnxruntime-node@1.30.0',
      platform: `linux/${packageArch}`
    });
    expect(readFileSync(join(destination, 'README.md'), 'utf8')).toBe('ONNX runtime');
    expect(
      readFileSync(
        join(destination, 'bin', 'napi-v6', 'linux', packageArch, 'onnxruntime_binding.node'),
        'utf8'
      )
    ).toBe(`linux/${packageArch}`);
    expect(existsSync(join(destination, 'bin', 'napi-v6', 'darwin'))).toBe(false);
    expect(existsSync(join(destination, 'bin', 'napi-v6', 'win32'))).toBe(false);
    expect(
      existsSync(
        join(destination, 'bin', 'napi-v6', 'linux', packageArch === 'x64' ? 'arm64' : 'x64')
      )
    ).toBe(false);
  });

  it('rejects unsupported Docker architectures and changed package versions', () => {
    const { source, destination } = fixture();
    expect(() => prepareOnnxRuntime(source, destination, 'riscv64')).toThrow(/unsupported/);
    writeFileSync(
      join(source, 'package.json'),
      JSON.stringify({ name: 'onnxruntime-node', version: '1.31.0' })
    );
    expect(() => prepareOnnxRuntime(source, destination, 'arm64')).toThrow(/locked version/);
  });

  it('rejects symlinks in the installed package payload', () => {
    const { source, destination } = fixture();
    symlinkSync(join(source, 'README.md'), join(source, 'linked-readme'));
    expect(() => prepareOnnxRuntime(source, destination, 'arm64')).toThrow(/symbolic link/);
  });
});
