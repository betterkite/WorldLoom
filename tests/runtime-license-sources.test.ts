import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const upstreamCopies = {
  'node-24.21.0.LICENSE': '5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace',
  'next-env-16.4.5.LICENSE': 'ee765244e2d59f5234d474f62e0766fa0c8b99af967fdd4c0cb8dcb0c76ea224',
  'onnxruntime-1.30.0.LICENSE': '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c',
  'onnxruntime-1.30.0-ThirdPartyNotices.txt':
    '143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3',
  'sharp-libvips-1.3.4.LICENSE': 'b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1',
  'sharp-libvips-1.3.4-THIRD-PARTY-NOTICES.md':
    '6f0d5086e3bcbee12bcdacf5878b31d1104002aeecaeb241d3fff466108082fe'
};

describe('version-matched upstream license source copies', () => {
  it.each(Object.entries(upstreamCopies))('retains exact bytes in %s', (filename, expected) => {
    const contents = readFileSync(join(process.cwd(), 'third_party/runtime-licenses', filename));
    expect(createHash('sha256').update(contents).digest('hex')).toBe(expected);
  });
});
