import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const compose = readFileSync(resolve(process.cwd(), 'docker-compose.yml'), 'utf8');
const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');
const localEmbeddings = readFileSync(
  resolve(process.cwd(), 'src/lib/llm/local-embeddings.ts'),
  'utf8'
);

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

  it('keeps the development database bound to loopback only', () => {
    expect(compose).toContain("'127.0.0.1:43133:5432'");
  });

  it('keeps the database healthcheck aligned with custom database settings', () => {
    expect(compose).toContain(
      'pg_isready -U ${POSTGRES_USER:-worldloom} -d ${POSTGRES_DB:-worldloom}'
    );
  });

  it('installs OpenSSL in every image stage for the Prisma runtime', () => {
    expect(dockerfile).toContain('ca-certificates openssl');
  });

  it('keeps local embedding runtime as a statically traceable server dependency', () => {
    expect(localEmbeddings).toContain("from '@huggingface/transformers'");
    expect(dockerfile).toContain('COPY --from=build /app/.next/standalone ./');
    expect(dockerfile).toContain('onnxruntime-node@1.30.0');
    expect(dockerfile).toContain('@huggingface+tokenizers@0.2.0');
  });

  it('keeps the worker concurrency cap explicit in the app container', () => {
    expect(compose).toContain(
      'WORLDLOOM_WORKER_MAX_CONCURRENCY: ${WORLDLOOM_WORKER_MAX_CONCURRENCY:-4}'
    );
  });

  it('mounts the ignored local embedding cache read-only into app and worker', () => {
    const appBlock = compose.match(/\n  app:\n([\s\S]*?)(?=\n  worker:)/)?.[1] ?? '';
    const workerBlock = compose.match(/\n  worker:\n([\s\S]*?)(?=\n  migrate:)/)?.[1] ?? '';
    const mount = './.cache/worldloom-embeddings:/app/.cache/worldloom-embeddings:ro';
    expect(appBlock).toContain(mount);
    expect(workerBlock).toContain(mount);
  });

  it('defines a separate full-profile worker without publishing a host port', () => {
    const workerBlock = compose.match(/\n  worker:\n([\s\S]*?)(?=\n  migrate:)/)?.[1] ?? '';
    expect(workerBlock).toContain('container_name: worldloom-worker');
    expect(workerBlock).toContain("WORLDLOOM_WORKER: 'true'");
    expect(workerBlock).toContain("profiles: ['full']");
    expect(workerBlock).not.toContain('ports:');
  });

  it('passes the canonical public origin into the runtime container', () => {
    expect(compose).toContain('NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL:-}');
  });
});
