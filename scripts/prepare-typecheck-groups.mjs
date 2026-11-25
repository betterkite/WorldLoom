import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GROUPS = ['backend', 'frontend', 'graph', 'ui', 'forms', 'tests', 'tools'];
const FORM_LIBS = new Set(['src/lib/form.ts', 'src/lib/form-context.ts']);

// This is a verification preparation tool, not a compiler or a PASS marker.
// Every root in the original tsconfig belongs to a group. Imports are resolved
// and checked normally by tsc; no stubs, noCheck or transpile-only shortcuts.
export function typecheckGroup(filename) {
  const path = filename.replaceAll('\\', '/');
  if (path.startsWith('tests/')) return 'tests';
  if (path === 'src/features/worlds/components/graph-tab.tsx' ||
    path.startsWith('src/app/dashboard/worlds/[worldId]/graph/')) return 'graph';
  if (path.startsWith('src/components/forms/') || FORM_LIBS.has(path)) return 'forms';
  if (path.startsWith('src/components/ui/')) return 'ui';
  if (path.startsWith('src/')) {
    return path !== 'src/lib/command-palette.ts' && (
      path.startsWith('src/lib/') || path.startsWith('src/app/api/') || path === 'src/instrumentation.ts'
    ) ? 'backend' : 'frontend';
  }
  return 'tools';
}

export function buildTypecheckGroups(filenames, shared = []) {
  const roots = new Set(filenames);
  if (!roots.size) throw new Error('Typecheck configuration has no root files');
  for (const file of [...roots, ...shared]) {
    if (!file || isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
      throw new Error('Typecheck roots must be workspace-relative');
    }
  }
  if (shared.some((file) => !roots.has(file))) throw new Error('Shared roots must belong to the base config');
  const groups = Object.fromEntries(GROUPS.map((name) => [name, new Set(shared)]));
  for (const file of roots) groups[typecheckGroup(file)].add(file);
  const covered = new Set(Object.values(groups).flatMap((files) => [...files]));
  if (covered.size !== roots.size || [...roots].some((file) => !covered.has(file))) {
    throw new Error('Serial typecheck does not cover the original root files');
  }
  return Object.fromEntries(Object.entries(groups).map(([name, files]) => [name, [...files].sort()]));
}

// Root scripts affect the global namespace; declaration/global/module
// augmentations must remain visible in every group, not just their owner.
export function sharedTypecheckRoot(ts, source) {
  if (source.isDeclarationFile || !ts.isExternalModule(source)) return true;
  let shared = false;
  const visit = (node) => {
    if (ts.isModuleDeclaration(node) && (
      ts.isStringLiteral(node.name) || (node.flags & ts.NodeFlags.GlobalAugmentation)
    )) shared = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return shared;
}

async function prepare() {
  const ts = (await import('typescript')).default;
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const configPath = resolve(root, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, configPath);
  if (parsed.errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors, {
    getCanonicalFileName: (file) => file, getCurrentDirectory: () => root, getNewLine: () => '\n'
  }));
  if (parsed.projectReferences?.length || parsed.options.noCheck) {
    throw new Error('Serial preparation requires a fully checked, non-reference base config');
  }
  const filenames = parsed.fileNames.map((file) => relative(root, file).replaceAll('\\', '/'));
  const shared = parsed.fileNames.filter((file) => {
    const text = ts.sys.readFile(file);
    if (text === undefined) throw new Error('Typecheck root disappeared during preparation');
    return sharedTypecheckRoot(ts, ts.createSourceFile(file, text, parsed.options.target, true));
  }).map((file) => relative(root, file).replaceAll('\\', '/'));
  const groups = buildTypecheckGroups(filenames, shared);
  const output = resolve(root, 'node_modules/.cache/worldloom/typecheck');
  mkdirSync(output, { recursive: true });
  for (const [name, files] of Object.entries(groups)) {
    writeFileSync(resolve(output, `${name}.json`), `${JSON.stringify({
      extends: configPath,
      files: files.map((file) => resolve(root, file)),
      include: [],
      // Only roots change. All compiler settings and aliases are inherited;
      // dependencies of these files are never excluded from checking.
      exclude: []
    }, null, 2)}\n`);
  }
  const manifest = {
    schemaVersion: 1,
    scope: 'complete-base-tsconfig-root-coverage; not monolithic equivalence or release approval',
    rootCount: filenames.length,
    rootsDigest: createHash('sha256').update(JSON.stringify([...filenames].sort())).digest('hex'),
    shared,
    groups: Object.fromEntries(Object.entries(groups).map(([name, files]) => [name, files.length]))
  };
  writeFileSync(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepare();
}
