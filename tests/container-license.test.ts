import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const verifier = resolve(process.cwd(), 'scripts/verify-image-payload.mjs');
const temporaryRoots: string[] = [];
const requiredNotices = [
  'MIT License',
  'Copyright (c) 2023 Kiranism',
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
  'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.'
].join('\n');
const quotedNotices = requiredNotices
  .split('\n')
  .map((line) => (line ? `> ${line}` : '>'))
  .join('\n');
const projectLicense = `
MIT License

Copyright (c) 2026 WorldLoom contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

function createPayload({
  license = projectLicense,
  notices = requiredNotices
}: { license?: string; notices?: string | null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'worldloom-image-payload-'));
  temporaryRoots.push(root);
  writeFileSync(join(root, 'LICENSE'), license);
  if (notices !== null) writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), notices);
  cpSync(resolve('public/fonts'), join(root, 'public/fonts'), { recursive: true });
  mkdirSync(join(root, '.next/static'), { recursive: true });
  // A synthetic CSS fixture for this payload contract, not a production build.
  writeFileSync(
    join(root, '.next/static/fonts.css'),
    readFileSync(resolve('src/components/themes/fonts.css'))
  );
  return root;
}

function runVerifier(root: string, args: string[] = []) {
  return spawnSync(process.execPath, [verifier, root, ...args], { encoding: 'utf8' });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('runtime image legal payload', () => {
  it('accepts the project license and complete upstream MIT notice', () => {
    const result = runVerifier(createPayload({ notices: quotedNotices }));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'PASS', secretLikeFiles: 0 });
  });

  it('requires local links in the application notices to resolve inside the payload', () => {
    const root = createPayload({
      notices: quotedNotices + '\n[Source index](third_party/sources.json)'
    });
    expect(runVerifier(root).stderr).toContain('Missing or invalid local notice link');
    mkdirSync(join(root, 'third_party'), { recursive: true });
    writeFileSync(join(root, 'third_party/sources.json'), '[]');
    expect(runVerifier(root).status).toBe(0);
  });

  it('accepts a project-license-only migration payload without third-party notices', () => {
    const result = runVerifier(createPayload({ notices: null }), ['--project-license-only']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'PASS',
      licenseBytes: expect.any(Number),
      thirdPartyNoticesBytes: 0,
      secretLikeFiles: 0
    });
  });

  it('requires third-party notices in the application runtime payload', () => {
    const result = runVerifier(createPayload({ notices: null }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('THIRD_PARTY_NOTICES.md is missing');
  });

  it('rejects an app payload that drops a bundled font license', () => {
    const root = createPayload();
    rmSync(join(root, 'public/fonts/inter.OFL.txt'));
    expect(runVerifier(root).status).toBe(1);
  });

  it('rejects a truncated project MIT license', () => {
    const result = runVerifier(
      createPayload({ license: 'MIT License\nCopyright (c) 2026 WorldLoom contributors' })
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing required MIT license text');
  });

  it('rejects missing upstream copyright or license terms', () => {
    const result = runVerifier(createPayload({ notices: 'incomplete notice' }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing required license text');
  });

  it('requires the upstream MIT heading next to its copyright, not only in prose', () => {
    const withoutHeading = `This project uses the MIT License.\n${requiredNotices.replace('MIT License\n', '')}`;
    const result = runVerifier(createPayload({ notices: withoutHeading }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing required license text');
  });

  it('rejects an upstream notice missing part of the permission grant', () => {
    const incomplete = requiredNotices.replace('sublicense, and/or sell', 'and/or sell');
    const result = runVerifier(createPayload({ notices: incomplete }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing required license text');
  });

  it('rejects dotenv files anywhere in the runtime payload', () => {
    const root = createPayload();
    const nested = join(root, 'config', 'credentials');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, '.env.production'), 'API_KEY=not-a-real-key');
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('secret-like files');
  });

  it.each(['src', 'tests', 'e2e', 'docs', '.git', '.cache'])(
    'rejects repository-only root %s without treating dependency source folders as forbidden',
    (directory) => {
      const root = createPayload();
      mkdirSync(join(root, 'node_modules/example/src'), { recursive: true });
      writeFileSync(join(root, 'node_modules/example/src/runtime.js'), 'module.exports = 1;');
      expect(runVerifier(root).status).toBe(0);
      mkdirSync(join(root, directory));
      writeFileSync(join(root, directory, 'fixture.txt'), 'synthetic');
      const result = runVerifier(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('development-only paths');
    }
  );

  it('rejects private key files and private key material in PEM files', () => {
    const root = createPayload();
    writeFileSync(join(root, 'identity.pem'), '-----BEGIN PRIVATE KEY-----\nplaceholder');
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('secret-like files');
  });

  it.each(['.reposteward.toml', '.DS_Store', 'config/.reposteward.toml', 'public/.DS_Store'])(
    'rejects local workstation metadata %s without needing to read its contents',
    (path) => {
      const root = createPayload();
      mkdirSync(join(root, 'config'), { recursive: true });
      writeFileSync(join(root, path), 'synthetic local metadata', { mode: 0o000 });
      const result = runVerifier(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('local workstation metadata');
    }
  );

  it('verifies staged legal files before copying the exact app tree into the runtime image', () => {
    const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');
    const dockerignore = readFileSync(resolve(process.cwd(), '.dockerignore'), 'utf8');
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    expect(dockerignore).toMatch(/^!THIRD_PARTY_NOTICES\.md$/m);
    expect(dockerignore).toContain(
      '!third_party/runtime-licenses/sharp-libvips-1.3.4-THIRD-PARTY-NOTICES.md'
    );
    for (const source of [
      'onnxruntime-1.30.0-ThirdPartyNotices.txt',
      'sharp-libvips-1.3.4-THIRD-PARTY-NOTICES.md'
    ]) {
      expect(dockerfile).toContain(
        `COPY third_party/runtime-licenses/${source} /tmp/runtime-license-sources/`
      );
    }
    for (const localEvidence of [
      'screenshots',
      'test-results',
      'playwright-report',
      'artifacts',
      'coverage'
    ]) {
      expect(dockerignore).toContain(`\n${localEvidence}\n`);
    }
    expect(dockerignore).toMatch(/^\.codex$/m);
    expect(dockerfile).toContain('FROM base AS runtime-payload');
    expect(dockerfile).toContain('RUN node /tmp/verify-image-payload.mjs /app');
    expect(dockerfile).toContain('COPY --from=runtime-payload /app ./');
    expect(dockerfile).toContain('COPY LICENSE ./LICENSE');
    expect(dockerfile).toContain(
      'COPY --from=build /app/THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md'
    );
    expect(workflow).toContain('--project-license-only');
    expect(workflow).toContain('worldloom-migrate:ci');
    expect(workflow).toContain('scripts/verify-image-payload.mjs:/tmp/verify-image-payload.mjs:ro');
    expect(workflow).toContain('--entrypoint node worldloom-migrate:ci');
    expect(workflow).toContain('--entrypoint /nodejs/bin/node worldloom:ci');
    expect(workflow).toContain('/tmp/verify-image-payload.mjs /app');
  });

  it('blocks CI on missing runtime notices in both migration and app images', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    expect(workflow).toMatch(
      /name: Audit migration runtime license payload[\s\S]*?\/tmp\/runtime-license-audit\.mjs \/app --strict/
    );
    expect(workflow).toMatch(
      /name: Audit production runtime license payload \(release gate\)[\s\S]*?\/tmp\/runtime-license-audit\.mjs \/app --strict/
    );
  });
});
