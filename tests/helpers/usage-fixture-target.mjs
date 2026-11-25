import { isIP } from 'node:net';

const SCHEMA = /^worldloom_usage_fixture_[0-9a-f]{32}$/;
const PARAMETERS = new Set([
  'schema',
  'connection_limit',
  'connect_timeout',
  'pool_timeout',
  'socket_timeout',
  'sslmode'
]);

export function assertUsageFixtureSchema(value) {
  if (typeof value !== 'string' || !SCHEMA.test(value)) {
    throw new Error('Usage fixture requires its exact generated WorldLoom schema');
  }
  return value;
}

export function usageFixtureMarker(schema) {
  return `worldloom-usage-fixture:${assertUsageFixtureSchema(schema).slice('worldloom_usage_fixture_'.length)}`;
}

/** Refuse production/other-project/external targets before creating a client.
 * Only the existing WorldLoom/CI test databases are accepted. Values withheld.
 */
export function usageFixtureDatabaseUrl(raw, { schema } = {}) {
  try {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error();
    const url = new URL(raw);
    const local =
      url.hostname === 'localhost' ||
      url.hostname === 'db' ||
      url.hostname === '[::1]' ||
      (isIP(url.hostname) === 4 && url.hostname.split('.')[0] === '127');
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !local ||
      url.hash ||
      !['/worldloom_test', '/ci_test'].includes(url.pathname) ||
      [...url.searchParams.keys()].some((key) => !PARAMETERS.has(key)) ||
      url.searchParams.getAll('schema').length > 1
    )
      throw new Error();
    const declared = url.searchParams.get('schema');
    if (schema !== undefined) {
      assertUsageFixtureSchema(schema);
      if (declared !== null && declared !== 'public' && declared !== schema) throw new Error();
      url.searchParams.set('schema', schema);
    } else {
      if (declared !== null && declared !== 'public') throw new Error();
      url.searchParams.set('schema', 'public');
    }
    url.searchParams.set('connection_limit', '1');
    url.searchParams.set('connect_timeout', '5');
    url.searchParams.set('pool_timeout', '5');
    url.searchParams.set('socket_timeout', '5');
    return url.toString();
  } catch {
    throw new Error(
      'Usage fixture requires a local WorldLoom/CI test database and its owned schema; target values withheld'
    );
  }
}
