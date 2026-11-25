import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('migration runtime dependency boundary', () => {
  it('uses the same pinned package manager in development, both Docker installs and CI', () => {
    const project = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    const migrate = JSON.parse(
      readFileSync(join(process.cwd(), 'docker/migrate/package.json'), 'utf8')
    );
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    expect(project.packageManager).toBe('pnpm@11.22.0');
    expect(migrate.packageManager).toBe(project.packageManager);
    expect(workflow.match(/version: 11\.22\.0/g)).toHaveLength(2);
    expect(workflow).toContain('pnpm e2e e2e/command-palette.spec.ts');
  });
  it('pins only the Prisma CLI at the project version', () => {
    const installed = JSON.parse(
      readFileSync(join(process.cwd(), 'node_modules/prisma/package.json'), 'utf8')
    );
    const migrate = JSON.parse(
      readFileSync(join(process.cwd(), 'docker/migrate/package.json'), 'utf8')
    );
    expect(migrate.dependencies).toEqual({ prisma: installed.version });
  });
});
