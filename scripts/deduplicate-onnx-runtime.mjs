import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Next instrumentation traces can retain pnpm copies despite route exclusions.
// Validate every copy before replacing it with a link to the selected payload.
export function deduplicateOnnxRuntime(root) {
  const app = realpathSync(resolve(root));
  const modules = join(app, 'node_modules');
  if (realpathSync(modules) !== modules ||
      (existsSync(join(modules, '.pnpm')) && lstatSync(join(modules, '.pnpm')).isSymbolicLink())) {
    throw new Error('ONNX module roots must not be symlinks');
  }
  const plans = [];
  for (const name of ['onnxruntime-node', 'onnxruntime-common']) {
    const canonical = join(modules, name);
    if (lstatSync(canonical).isSymbolicLink()) throw new Error('canonical ONNX package must not be a symlink');
    const metadata = JSON.parse(readFileSync(join(canonical, 'package.json'), 'utf8'));
    if (metadata.name !== name || metadata.version !== '1.30.0') throw new Error('canonical ONNX version mismatch');
    const selected = name === 'onnxruntime-node'
      ? ['arm64', 'x64'].filter((arch) => existsSync(join(canonical, 'bin/napi-v6/linux', arch)))
      : [];
    if (name === 'onnxruntime-node' && selected.length !== 1) throw new Error('canonical ONNX must select one Linux architecture');
    const duplicates = [];
    function locate(directory) {
      if (!existsSync(directory)) return;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        // pnpm dependency links keep working after their physical target is relinked.
        if (!entry.isDirectory()) continue;
        const path = join(directory, entry.name);
        if (entry.name === name) duplicates.push(path);
        else locate(path);
      }
    }
    locate(join(modules, '.pnpm'));
    for (const duplicate of duplicates) {
      const identity = JSON.parse(readFileSync(join(duplicate, 'package.json'), 'utf8'));
      if (identity.name !== name || identity.version !== metadata.version) throw new Error('traced ONNX version mismatch');
      const discarded = [];
      function compare(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const file = join(directory, entry.name);
          const path = relative(duplicate, file);
          if (entry.isDirectory()) { compare(file); continue; }
          if (!entry.isFile()) throw new Error('traced ONNX payload must contain only regular files');
          const target = join(canonical, path);
          const foreign = /^bin\/napi-v6\/(darwin|win32|linux)\/(arm64|x64)\//.exec(path.split(sep).join('/'));
          if (name === 'onnxruntime-node' && foreign &&
              (foreign[1] !== 'linux' || foreign[2] !== selected[0])) {
            discarded.push(path);
            continue;
          }
          if (!existsSync(target) || !lstatSync(target).isFile() ||
              realpathSync(target) !== target || !readFileSync(file).equals(readFileSync(target))) {
            throw new Error('traced ONNX bytes differ from canonical payload: ' + path);
          }
        }
      }
      compare(duplicate);
      plans.push({ package: name, path: duplicate, canonical, discarded });
    }
  }
  // All package identities and retained bytes must pass before any deletion.
  for (const plan of plans) {
    rmSync(plan.path, { recursive: true });
    symlinkSync(relative(dirname(plan.path), plan.canonical), plan.path, 'dir');
  }
  return plans.map((plan) => ({
    package: plan.package, path: relative(app, plan.path),
    target: relative(app, plan.canonical), discarded: plan.discarded
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('expected application payload root');
    console.log(JSON.stringify(deduplicateOnnxRuntime(process.argv[2])));
  } catch (error) {
    console.error('ONNX runtime deduplication failed: ' + error.message);
    process.exitCode = 1;
  }
}
