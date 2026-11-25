import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  buildTypecheckGroups,
  sharedTypecheckRoot,
  typecheckGroup
} from '../scripts/prepare-typecheck-groups.mjs';

describe('serial typecheck root coverage', () => {
  it('assigns every original root, including future folders, and shares ambient roots', () => {
    const roots = [
      'src/lib/llm/client.ts',
      'src/lib/form.ts',
      'src/lib/form-context.ts',
      'src/lib/command-palette.ts',
      'src/components/ui/button.tsx',
      'src/components/forms/fields/text-field.tsx',
      'src/components/example.tsx',
      'tests/example.test.ts',
      'e2e/example.spec.ts',
      '.next/types/validator.ts',
      'new-module/example.ts',
      'src/types/data-table.ts'
    ];
    const shared = ['src/types/data-table.ts'];
    const groups = buildTypecheckGroups(roots, shared);
    expect(new Set(Object.values(groups).flat())).toEqual(new Set(roots));
    for (const files of Object.values(groups)) expect(files).toContain(shared[0]);
    expect(groups.backend).toContain('src/lib/llm/client.ts');
    expect(groups.frontend).toContain('src/lib/command-palette.ts');
    expect(groups.forms).toEqual(
      expect.arrayContaining([
        'src/lib/form.ts',
        'src/lib/form-context.ts',
        'src/components/forms/fields/text-field.tsx'
      ])
    );
    expect(groups.ui).toContain('src/components/ui/button.tsx');
    expect(groups.tools).toEqual(
      expect.arrayContaining(['new-module/example.ts', '.next/types/validator.ts'])
    );
    expect(typecheckGroup('src\\app\\api\\llm\\usage\\route.ts')).toBe('backend');
  });

  it.each([
    { files: [] },
    { files: ['/outside.ts'] },
    { files: ['../outside.ts'] },
    { files: ['src/../../outside.ts'] }
  ])('rejects empty or escaping root lists: %j', ({ files }) => {
    expect(() => buildTypecheckGroups(files)).toThrow();
  });

  it('rejects invented shared roots instead of silently changing the file universe', () => {
    expect(() => buildTypecheckGroups(['src/example.ts'], ['extra.d.ts'])).toThrow();
  });

  it('checks the 3D graph entry points separately without losing normal dependency checking', () => {
    const graphRoots = [
      'src/features/worlds/components/graph-tab.tsx',
      'src/app/dashboard/worlds/[worldId]/graph/page.tsx',
      'src/app/dashboard/worlds/[worldId]/graph/future-component.tsx'
    ];
    const otherRoots = ['src/features/worlds/components/world-detail.tsx', 'src/lib/graph/view.ts'];
    const groups = buildTypecheckGroups([...graphRoots, ...otherRoots]);
    expect(groups.graph).toEqual(graphRoots.toSorted());
    expect(groups.frontend).toContain(otherRoots[0]);
    expect(groups.backend).toContain(otherRoots[1]);
    expect(typecheckGroup('src\\app\\dashboard\\worlds\\[worldId]\\graph\\page.tsx')).toBe('graph');
    expect(new Set(Object.values(groups).flat())).toEqual(new Set([...graphRoots, ...otherRoots]));
  });

  it.each([
    ['ambient.d.ts', 'export interface Ambient {}', true],
    ['script.ts', 'const globalValue = 1;', true],
    ['global.ts', 'export {}; declare global { interface Window { example: string } }', true],
    [
      'augment.ts',
      "export {}; declare module 'example' { interface Example { value: string } }",
      true
    ],
    ['module.ts', 'export const value = 1;', false],
    ['namespace.ts', 'export namespace Local { export const value = 1; }', false]
  ] as const)('preserves global/augmentation visibility for %s', (file, text, expected) => {
    expect(
      sharedTypecheckRoot(ts, ts.createSourceFile(file, text, ts.ScriptTarget.ES2017, true))
    ).toBe(expected);
  });
});
