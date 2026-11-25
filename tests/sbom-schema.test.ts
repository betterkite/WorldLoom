import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySchemaBytes } from '../scripts/validate-sbom.mjs';

const name = 'fixture.schema.json';
const bytes = Buffer.from(
  JSON.stringify({ $id: `http://cyclonedx.org/schema/${name}`, type: 'object' })
);
const source = { name, sha256: createHash('sha256').update(bytes).digest('hex') };

describe('SBOM schema source integrity', () => {
  it('accepts only the recorded digest and expected schema ID', () => {
    expect(verifySchemaBytes(source, bytes)).toMatchObject({
      $id: `http://cyclonedx.org/schema/${name}`
    });
  });

  it('rejects changed upstream bytes even when the schema ID is unchanged', () => {
    expect(() => verifySchemaBytes(source, Buffer.concat([bytes, Buffer.from('\n')]))).toThrow(
      'digest mismatch'
    );
  });

  it('rejects an unexpected schema ID even if its bytes have a matching digest', () => {
    const changed = Buffer.from('{"$id":"https://example.invalid/schema"}');
    expect(() =>
      verifySchemaBytes(
        { ...source, sha256: createHash('sha256').update(changed).digest('hex') },
        changed
      )
    ).toThrow('unexpected upstream schema ID');
  });
});
