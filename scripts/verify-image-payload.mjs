#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditBundledFonts } from './font-assets-audit.mjs';

const requiredLicenseFragments = [
  'MIT LICENSE',
  'PERMISSION IS HEREBY GRANTED, FREE OF CHARGE, TO ANY PERSON OBTAINING A COPY OF THIS SOFTWARE AND ASSOCIATED DOCUMENTATION FILES (THE "SOFTWARE"), TO DEAL IN THE SOFTWARE WITHOUT RESTRICTION, INCLUDING WITHOUT LIMITATION THE RIGHTS TO USE, COPY, MODIFY, MERGE, PUBLISH, DISTRIBUTE, SUBLICENSE, AND/OR SELL COPIES OF THE SOFTWARE, AND TO PERMIT PERSONS TO WHOM THE SOFTWARE IS FURNISHED TO DO SO, SUBJECT TO THE FOLLOWING CONDITIONS:',
  'THE ABOVE COPYRIGHT NOTICE AND THIS PERMISSION NOTICE SHALL BE INCLUDED IN ALL COPIES OR SUBSTANTIAL PORTIONS OF THE SOFTWARE.',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.'
];
const requiredNoticeFragments = [
  'MIT License Copyright (c) 2023 Kiranism',
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
  'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.'
];
const privateKeyFilename =
  /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|.+\.(?:key|p12|pfx|jks))$/i;
const privateKeyHeader = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/;

export function verifyRuntimePayload(root, { projectLicenseOnly = false } = {}) {
  const appRoot = resolve(root);
  const developmentDirectories = new Set([
    '.git', '.github', '.agents', '.husky', '.vscode', '.codex', '.cache',
    '.pnpm-store', 'src', 'tests', 'e2e', 'docs'
  ]);
  const developmentFiles = readdirSync(appRoot).filter((name) => developmentDirectories.has(name));
  if (developmentFiles.length) {
    throw new Error('runtime payload contains development-only paths: ' + developmentFiles.join(', '));
  }
  const license = readFileSync(join(appRoot, 'LICENSE'), 'utf8');
  const noticesPath = join(appRoot, 'THIRD_PARTY_NOTICES.md');
  const notices = existsSync(noticesPath) ? readFileSync(noticesPath, 'utf8') : '';
  if (!license.trim()) throw new Error('WorldLoom LICENSE is empty');
  const normalizedLicense = license.replace(/\s+/g, ' ').trim().toUpperCase();
  if (!/COPYRIGHT \(C\) \d{4} WORLDLOOM CONTRIBUTORS/i.test(license)) {
    throw new Error('WorldLoom LICENSE is missing the project copyright holder');
  }
  for (const fragment of requiredLicenseFragments) {
    if (!normalizedLicense.includes(fragment)) {
      throw new Error('WorldLoom LICENSE is missing required MIT license text: ' + fragment);
    }
  }
  if (!projectLicenseOnly) {
    if (!notices.trim()) throw new Error('THIRD_PARTY_NOTICES.md is missing');
    const payloadRoot = realpathSync(appRoot);
    for (const [, href] of notices.matchAll(/\]\(([^\s)]+)\)/g)) {
      if (/^https?:\/\//i.test(href) || href.startsWith('#')) continue;
      const file = resolve(payloadRoot, decodeURIComponent(href.split('#')[0]));
      if (!file.startsWith(payloadRoot + sep) || !existsSync(file) ||
          !realpathSync(file).startsWith(payloadRoot + sep) || !statSync(file).isFile()) {
        throw new Error(`Missing or invalid local notice link: ${href}`);
      }
    }
    const normalizedNotices = notices
      .replace(/^\s*>\s?/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
    for (const fragment of requiredNoticeFragments) {
      if (!normalizedNotices.includes(fragment)) {
        throw new Error('THIRD_PARTY_NOTICES.md is missing required license text: ' + fragment);
      }
    }
  }

  const forbiddenFiles = [];
  const localMetadataFiles = [];
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.name === '.reposteward.toml' || entry.name === '.DS_Store') {
        localMetadataFiles.push(path);
      }
      if (entry.name.startsWith('.env') || privateKeyFilename.test(entry.name)) {
        forbiddenFiles.push(path);
      }
      if (entry.isDirectory()) {
        scan(path);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pem')) {
        if (privateKeyHeader.test(readFileSync(path, 'utf8'))) forbiddenFiles.push(path);
      }
    }
  }
  scan(appRoot);
  if (localMetadataFiles.length) {
    throw new Error('runtime payload contains local workstation metadata: ' + localMetadataFiles.join(', '));
  }
  if (forbiddenFiles.length) {
    throw new Error('runtime payload contains secret-like files: ' + forbiddenFiles.join(', '));
  }

  const fontInventory = projectLicenseOnly ? null : auditBundledFonts(appRoot, { payload: true });

  return {
    licenseBytes: Buffer.byteLength(license),
    thirdPartyNoticesBytes: Buffer.byteLength(notices),
    secretLikeFiles: 0,
    ...(fontInventory ? { fontFiles: fontInventory.fontFiles, fontManifestSha256: fontInventory.manifestSha256 } : {})
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify({
        status: 'PASS',
        ...verifyRuntimePayload(process.argv[2] ?? '/app', {
          projectLicenseOnly: process.argv.includes('--project-license-only')
        })
      })
    );
  } catch (error) {
    console.error('runtime payload verification failed: ' + error.message);
    process.exitCode = 1;
  }
}
