#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const allowed = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC-BY-4.0',
  'ISC',
  'LGPL-3.0-or-later',
  'MIT',
  '(MIT OR CC0-1.0)',
  'MPL-2.0'
]);

const raw = execFileSync('pnpm', ['licenses', 'list', '--json'], { encoding: 'utf8' });
const inventory = JSON.parse(raw);
const families = Object.keys(inventory).toSorted();
const unknown = families.filter((license) => !allowed.has(license));

if (unknown.length > 0) {
  console.error(`Unknown or unreviewed license families: ${unknown.join(', ')}`);
  for (const license of unknown) {
    for (const packageInfo of inventory[license] ?? []) {
      console.error(`  - ${packageInfo.name}@${packageInfo.versions?.join(',') ?? 'unknown'}`);
    }
  }
  process.exit(1);
}

console.log(`License audit passed: ${families.length} reviewed families`);
