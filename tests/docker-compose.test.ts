import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const compose = readFileSync(resolve(process.cwd(), 'docker-compose.yml'), 'utf8');
const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');

describe('production compose migration gate', () => {
  it('runs migrations before the app accepts traffic', () => {
    expect(compose).toContain('target: migrate');
    expect(compose).toContain('condition: service_completed_successfully');
    expect(dockerfile).toContain('CMD ["pnpm", "db:deploy"]');
  });

  it('does not pass the host DATABASE_URL into containers by accident', () => {
    expect(compose).toContain('WORLDLOOM_CONTAINER_DATABASE_URL');
    expect(compose).not.toContain('DATABASE_URL: ${DATABASE_URL:-');
    expect(compose).toContain('@db:5432/');
  });

  it('keeps the database healthcheck aligned with custom database settings', () => {
    expect(compose).toContain(
      'pg_isready -U ${POSTGRES_USER:-worldloom} -d ${POSTGRES_DB:-worldloom}'
    );
  });
});
