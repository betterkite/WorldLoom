import { randomBytes } from 'node:crypto';

/**
 * Stable content identity across world versions.
 * UIDs are short, url-safe and prefixed by kind for debuggability:
 *   ent_ / evt_ / epo_ / rel_ / src_
 */
export function newUid(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}
