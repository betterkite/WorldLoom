import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyNextVendoredNotices } from '../scripts/verify-next-vendored-notices.mjs';

const roots: string[] = [];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'worldloom-vendored-'));
  roots.push(root);
  const parent = join(root, 'node_modules/next');
  const payload = join(parent, 'dist/compiled/example');
  const notices = join(root, 'third_party/next-vendored');
  mkdirSync(payload, { recursive: true });
  mkdirSync(notices, { recursive: true });
  const metadata = JSON.stringify({ name: 'next', version: '16.3.5', license: 'MIT' });
  writeFileSync(join(parent, 'package.json'), metadata);
  writeFileSync(join(payload, 'index.js'), 'module.exports = 1;');
  writeFileSync(join(notices, 'example.NOTICE'), 'Original fixture notice');
  const manifest = {
    schemaVersion: 1,
    parent: { name: 'next', version: '16.3.5', packageJsonSha256: hash(metadata) },
    components: [
      {
        name: 'example',
        version: '1.0.0',
        license: 'MIT',
        directory: 'dist/compiled/example',
        payloadFiles: [{ path: 'index.js', sha256: hash('module.exports = 1;') }],
        notice: { file: 'example.NOTICE', sha256: hash('Original fixture notice') }
      }
    ]
  };
  const save = () => writeFileSync(join(notices, 'manifest.json'), JSON.stringify(manifest));
  save();
  return { root, parent, payload, notices, manifest, save };
}

describe('exact traced Next component notice binding', () => {
  function supplement() {
    const f = fixture();
    const item = {
      name: 'transitive',
      version: '1.0.0',
      notice: { file: 'transitive.NOTICE', sha256: hash('Original transitive notice') },
      payload: { path: 'dist/compiled/fontkit/index.js', sha256: hash('compiled fontkit') }
    };
    mkdirSync(join(f.parent, 'dist/compiled/fontkit'), { recursive: true });
    writeFileSync(join(f.parent, item.payload.path), 'compiled fontkit');
    writeFileSync(join(f.notices, item.notice.file), 'Original transitive notice');
    Object.assign(f.manifest, { supplementalNotices: [item] });
    f.save();
    return { ...f, item };
  }

  it('binds supplemental texts to traced bytes and reports an untraced supplement separately', () => {
    const f = supplement();
    expect(verifyNextVendoredNotices(f.root).tracedSupplementalNotices).toHaveLength(1);
    rmSync(join(f.parent, f.item.payload.path));
    const result = verifyNextVendoredNotices(f.root);
    expect(result.supplementalNoticeCount).toBe(1);
    expect(result.tracedSupplementalNotices).toEqual([]);
  });

  it('rejects supplemental text tampering, missing originals and changed compiled bytes', () => {
    const f = supplement();
    writeFileSync(join(f.notices, f.item.notice.file), 'changed');
    expect(() => verifyNextVendoredNotices(f.root)).toThrow(/digest mismatch/);
    rmSync(join(f.notices, f.item.notice.file));
    expect(() => verifyNextVendoredNotices(f.root)).toThrow();
    const g = supplement();
    writeFileSync(join(g.parent, g.item.payload.path), 'new compiled fontkit');
    expect(() => verifyNextVendoredNotices(g.root)).toThrow(/digest mismatch/);
  });

  it('rejects supplemental payload traversal and dangling symlinks', () => {
    const f = supplement();
    f.item.payload.path = 'dist/compiled/../outside';
    f.save();
    expect(() => verifyNextVendoredNotices(f.root)).toThrow(/unsafe/);
    const g = supplement();
    rmSync(join(g.parent, g.item.payload.path));
    symlinkSync(join(g.root, 'absent'), join(g.parent, g.item.payload.path));
    expect(() => verifyNextVendoredNotices(g.root)).toThrow(/symlink/);
  });

  it('binds original text to the actual payload without claiming transitive coverage', () => {
    const f = fixture();
    const result = verifyNextVendoredNotices(f.root);
    expect(result.tracedComponentCount).toBe(1);
    expect(result.components[0].verifiedFiles).toEqual(['index.js']);
    expect(result.coverage).toContain('transitive');
    expect(readFileSync(join(f.payload, 'index.js'), 'utf8')).toBe('module.exports = 1;');
  });

  it('rejects changed runtime versions and changed code even with the same version', () => {
    const f = fixture();
    writeFileSync(
      join(f.parent, 'package.json'),
      JSON.stringify({ name: 'next', version: '16.4.0' })
    );
    expect(() => verifyNextVendoredNotices(f.root)).toThrow(/version differs/);
    const g = fixture();
    writeFileSync(join(g.payload, 'index.js'), 'module.exports = 2;');
    expect(() => verifyNextVendoredNotices(g.root)).toThrow(/digest mismatch/);
  });

  it('rejects extra payload files rather than treating an adjacent notice as coverage', () => {
    const f = fixture();
    writeFileSync(join(f.payload, 'additional.js'), 'unreviewed source');
    expect(() => verifyNextVendoredNotices(f.root)).toThrow(/unbound vendored payload/);
  });

  it('rejects altered or missing original notices', () => {
    const f = fixture();
    writeFileSync(join(f.notices, 'example.NOTICE'), 'different notice');
    expect(() => verifyNextVendoredNotices(f.root)).toThrow(/digest mismatch/);
    rmSync(join(f.notices, 'example.NOTICE'));
    expect(() => verifyNextVendoredNotices(f.root)).toThrow();
  });

  it('rejects traversal and dangling directory symlinks', () => {
    const f = fixture();
    f.manifest.components[0].notice.file = '../outside';
    f.save();
    expect(() => verifyNextVendoredNotices(f.root)).toThrow(/unsafe/);
    const g = fixture();
    rmSync(g.payload, { recursive: true });
    symlinkSync(join(g.root, 'nonexistent'), g.payload);
    expect(() => verifyNextVendoredNotices(g.root)).toThrow(/symlink/);
  });

  it('permits an omitted untraced file but requires some actual bound payload', () => {
    const f = fixture();
    f.manifest.components[0].payloadFiles.push({ path: 'untraced.js', sha256: hash('untraced') });
    f.save();
    expect(verifyNextVendoredNotices(f.root).tracedComponentCount).toBe(1);
    rmSync(f.payload, { recursive: true });
    expect(() => verifyNextVendoredNotices(f.root)).toThrow(/no matching/);
  });
});
