import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  stageProductionNotices,
  verifyProductionNotices
} from '../scripts/stage-production-notices.mjs';

const roots: string[] = [];
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'production-notices-'));
  roots.push(base);
  const source = join(base, 'source');
  mkdirSync(source);
  const metadata = { name: 'fixture', version: '1.0.0', dependencies: { widget: '1.2.0' } };
  writeFileSync(join(source, 'package.json'), JSON.stringify(metadata));
  writeFileSync(join(source, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  const widget = join(source, 'node_modules/widget');
  mkdirSync(join(widget, 'nested'), { recursive: true });
  writeFileSync(
    join(widget, 'package.json'),
    JSON.stringify({
      name: 'widget',
      version: '1.2.0',
      license: 'MIT',
      optionalDependencies: { platform: '2.0.0' }
    })
  );
  writeFileSync(join(widget, 'LICENSE'), 'original license\r\n© Widget\r\n');
  writeFileSync(join(widget, 'nested/NOTICE.txt'), 'original nested notice\n');
  const tree = {
    ...metadata,
    path: source,
    dependencies: {
      widget: {
        version: '1.2.0',
        path: widget,
        dependencies: {
          platform: {
            version: '2.0.0',
            path: join(source, 'node_modules/platform'),
            dependencies: {
              indirect: { version: '3.0.0', path: join(source, 'node_modules/indirect') }
            }
          }
        }
      }
    }
  };
  const graph = join(base, 'tree.json');
  const output = join(base, 'notices');
  const save = () => writeFileSync(graph, JSON.stringify([tree]));
  const stage = () => {
    save();
    return stageProductionNotices(source, graph, output);
  };
  return { base, source, widget, tree, graph, output, save, stage };
}
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});

describe('production dependency notices', () => {
  it('binds supplemental browser notices to the installed version and exact text', () => {
    const f = fixture();
    f.stage();
    const browser = join(f.base, 'browser');
    mkdirSync(browser);
    const text = 'Original notice\n';
    const entry = {
      package: 'widget',
      version: '1.2.0',
      file: 'widget.LICENSE.NOTICE',
      sha256: createHash('sha256').update(text).digest('hex')
    };
    const index = join(browser, 'sources.json');
    writeFileSync(index, JSON.stringify([entry]));
    writeFileSync(join(browser, entry.file), text);
    expect(verifyProductionNotices(f.output, browser).browserNotices).toBe(1);
    writeFileSync(join(browser, entry.file), 'changed');
    expect(() => verifyProductionNotices(f.output, browser)).toThrow('digest mismatch');
    writeFileSync(index, JSON.stringify([{ ...entry, version: '2.0.0' }]));
    expect(() => verifyProductionNotices(f.output, browser)).toThrow('not installed');
  });

  it('collects all original texts inside plural LICENSES directories', () => {
    const f = fixture();
    mkdirSync(join(f.widget, 'LICENSES'));
    writeFileSync(join(f.widget, 'LICENSES/MIT'), 'unmodified upstream grant');
    const m = f.stage();
    const file = m.components
      .find((c) => c.status === 'installed')!
      .files.find((f: { source: string; path: string }) => f.source === 'LICENSES/MIT');
    expect(file).toBeDefined();
    expect(readFileSync(join(f.output, file!.path), 'utf8')).toBe('unmodified upstream grant');
  });

  it('preserves exact nested originals and proves omitted optional ancestry', () => {
    const f = fixture();
    const manifest = f.stage();
    expect(verifyProductionNotices(f.output)).toEqual({
      status: 'PASS',
      components: 3,
      installed: 1,
      omittedOptional: 2
    });
    const installed = manifest.components.find((c) => c.status === 'installed')!;
    expect(installed.files).toHaveLength(3);
    for (const file of installed.files) {
      expect(readFileSync(join(f.output, file.path))).toEqual(
        readFileSync(join(f.widget, file.source))
      );
    }
    expect(manifest.components.find((c) => c.name === 'indirect')?.optionalRoots).toEqual([
      { parent: 'widget@1.2.0', name: 'platform', range: '2.0.0' }
    ]);
  });

  it('rejects a missing required dependency before publishing any output', () => {
    const f = fixture();
    writeFileSync(
      join(f.widget, 'package.json'),
      JSON.stringify({ name: 'widget', version: '1.2.0', license: 'MIT' })
    );
    expect(f.stage).toThrow('Missing required production dependency');
    expect(existsSync(f.output)).toBe(false);
    expect(existsSync(f.output + '.staging')).toBe(false);
  });

  it('rejects a graph that drops a declared root dependency', () => {
    const f = fixture();
    writeFileSync(
      join(f.source, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        dependencies: { widget: '1.2.0', dropped: '1' }
      })
    );
    expect(f.stage).toThrow('does not cover');
  });

  it('uses the installed version of local file dependencies', () => {
    const f = fixture();
    f.tree.dependencies.widget.version = 'file:packages/widget';
    expect(f.stage().components.find((c) => c.name === 'widget')?.version).toBe('1.2.0');
  });

  it('distinguishes README fallback and declaration-only evidence', () => {
    const f = fixture();
    rmSync(join(f.widget, 'LICENSE'));
    rmSync(join(f.widget, 'nested'), { recursive: true });
    writeFileSync(join(f.widget, 'README.md'), '# Widget\nMIT\n');
    expect(f.stage().components.find((c) => c.name === 'widget')?.evidence).toBe(
      'declaration-and-readme'
    );
    rmSync(f.output, { recursive: true });
    rmSync(join(f.widget, 'README.md'));
    expect(f.stage().components.find((c) => c.name === 'widget')?.evidence).toBe(
      'declaration-only'
    );
  });

  it('rejects a declared version that differs from installed metadata', () => {
    const f = fixture();
    f.tree.dependencies.widget.version = '1.3.0';
    expect(f.stage).toThrow('identity mismatch');
  });

  it('rejects selected notice symlinks and packages outside the source', () => {
    const f = fixture();
    rmSync(join(f.widget, 'LICENSE'));
    symlinkSync(join(f.widget, 'nested/NOTICE.txt'), join(f.widget, 'LICENSE'));
    expect(f.stage).toThrow('Symlinked notice');
    f.tree.dependencies.widget.path = f.base;
    expect(f.stage).toThrow('Invalid dependency path');
  });

  it('rejects conflicting originals across peer contexts of the same version', () => {
    const f = fixture();
    const copy = join(f.source, 'node_modules/peer/widget');
    mkdirSync(copy, { recursive: true });
    writeFileSync(join(copy, 'package.json'), readFileSync(join(f.widget, 'package.json')));
    writeFileSync(join(copy, 'LICENSE'), 'different source');
    Object.assign(f.tree.dependencies.widget.dependencies, {
      widget: { version: '1.2.0', path: copy }
    });
    expect(f.stage).toThrow('Conflicting original notices');
  });

  it('rejects modified, missing, and extra distributed files', () => {
    const f = fixture();
    const manifest = f.stage();
    const file = join(
      f.output,
      manifest.components.find((c) => c.status === 'installed')!.files[1].path
    );
    const original = readFileSync(file);
    writeFileSync(file, 'tampered');
    expect(() => verifyProductionNotices(f.output)).toThrow('digest mismatch');
    rmSync(file);
    expect(() => verifyProductionNotices(f.output)).toThrow();
    writeFileSync(file, original);
    writeFileSync(join(f.output, 'unexpected'), 'x');
    expect(() => verifyProductionNotices(f.output)).toThrow('Unexpected');
  });

  it('rejects unjustified omissions and escaping manifest paths', () => {
    const f = fixture();
    const m = f.stage();
    m.components.find((c) => c.status === 'omitted-optional')!.optionalRoots[0].name = 'required';
    writeFileSync(join(f.output, 'manifest.json'), JSON.stringify(m));
    expect(() => verifyProductionNotices(f.output)).toThrow('optional dependency declaration');
    m.project.declaration.path = '../source/package.json.NOTICE';
    writeFileSync(join(f.output, 'manifest.json'), JSON.stringify(m));
    expect(() => verifyProductionNotices(f.output)).toThrow('Unsafe');
  });
});
