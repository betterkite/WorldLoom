import { describe, expect, it } from 'vitest';
import {
  assertUsageFixtureSchema,
  usageFixtureDatabaseUrl,
  usageFixtureMarker
} from './helpers/usage-fixture-target.mjs';

const schema = 'worldloom_usage_fixture_0123456789abcdef0123456789abcdef';
const base = 'postgresql://fixture:private-fixture-sentinel@localhost:43133/worldloom_test';

describe('isolated usage fixture target guards (no connection)', () => {
  it.each(['localhost', '127.0.0.1', '127.0.0.2', '[::1]', 'db'])(
    'accepts the explicit local test target %s with one bounded connection',
    (host) => {
      const url = new URL(usageFixtureDatabaseUrl(base.replace('localhost', host), { schema }));
      expect(url.hostname).toBe(host);
      expect(url.pathname).toBe('/worldloom_test');
      expect(url.searchParams.get('schema')).toBe(schema);
      expect(url.searchParams.get('connection_limit')).toBe('1');
      for (const key of ['connect_timeout', 'pool_timeout', 'socket_timeout']) {
        expect(url.searchParams.get(key)).toBe('5');
      }
    }
  );

  it('accepts the dedicated CI database, without selecting an arbitrary schema', () => {
    const url = new URL(usageFixtureDatabaseUrl(base.replace('/worldloom_test', '/ci_test')));
    expect(url.searchParams.get('schema')).toBe('public');
  });

  it('replaces allowed connection limits rather than adding ambiguous duplicates', () => {
    const url = new URL(
      usageFixtureDatabaseUrl(
        `${base}?schema=public&connection_limit=99&connection_limit=20&connect_timeout=100`,
        { schema }
      )
    );
    expect(url.searchParams.getAll('connection_limit')).toEqual(['1']);
    expect(url.searchParams.getAll('connect_timeout')).toEqual(['5']);
  });

  it.each([
    undefined,
    '',
    base.replace('/worldloom_test', '/worldloom'),
    base.replace('/worldloom_test', '/other_test'),
    base.replace('/worldloom_test', '/worldloom_test_other'),
    base.replace('localhost', 'localhost.example.com'),
    base.replace('localhost', '192.168.1.10'),
    base.replace('postgresql:', 'https:'),
    `${base}#private-fixture-sentinel`,
    `${base}?host=remote.example.com`,
    `${base}?options=-c%20search_path%3Dpublic`,
    `${base}?schema=pg_catalog`,
    `${base}?schema=public&schema=public`,
    `${base}?schema=other_schema`
  ])('refuses a non-owned target without exposing its values (case %#)', (raw) => {
    let error: unknown;
    try {
      usageFixtureDatabaseUrl(raw, { schema });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'Usage fixture requires a local WorldLoom/CI test database and its owned schema; target values withheld'
    );
    expect((error as Error).message).not.toContain('private-fixture-sentinel');
  });

  it.each([
    'public',
    'worldloom_usage_fixture_short',
    `${schema}_extra`,
    `${schema}"; DROP SCHEMA public; --`
  ])('refuses a schema outside the exact generated identifier grammar (case %#)', (value) => {
    expect(() => assertUsageFixtureSchema(value)).toThrow(
      'Usage fixture requires its exact generated WorldLoom schema'
    );
    expect(() => usageFixtureDatabaseUrl(base, { schema: value })).toThrow(
      'target values withheld'
    );
  });

  it('accepts its already scoped URL but refuses another owner or an unscoped reuse', () => {
    const scoped = usageFixtureDatabaseUrl(base, { schema });
    expect(usageFixtureDatabaseUrl(scoped, { schema })).toBe(scoped);
    const other = 'worldloom_usage_fixture_ffffffffffffffffffffffffffffffff';
    expect(() => usageFixtureDatabaseUrl(scoped, { schema: other })).toThrow(
      'target values withheld'
    );
    expect(() => usageFixtureDatabaseUrl(scoped)).toThrow('target values withheld');
    expect(usageFixtureMarker(schema)).toBe(
      'worldloom-usage-fixture:0123456789abcdef0123456789abcdef'
    );
  });
});
