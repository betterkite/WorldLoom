import { describe, expect, it, vi } from 'vitest';
import { navGroups } from '@/config/nav-config';
import {
  matchPaletteShortcut,
  navigationCommands,
  resolveWorldNavigation,
  type PaletteCommand
} from '@/lib/command-palette';

const commands: PaletteCommand[] = [
  { id: 'theme', name: 'theme', section: 'appearance', shortcut: ['d', 'd'], perform: vi.fn() },
  { id: 'worlds', name: 'worlds', section: 'navigation', shortcut: ['g', 'w'], perform: vi.fn() }
];

describe('command palette navigation', () => {
  it('resolves the current world without mutating shared navigation configuration', () => {
    const navigate = vi.fn();
    const actions = navigationCommands(resolveWorldNavigation(navGroups, 'test-world'), navigate);
    actions.find((action) => action.name === '故事创作')?.perform();
    expect(navigate).toHaveBeenCalledWith('/dashboard/worlds/test-world/story');
    expect(JSON.stringify(navGroups)).toContain(':worldId');
  });

  it('uses overview if no validated world is available, including nested items', () => {
    const navigate = vi.fn();
    const groups = [
      {
        label: 'group',
        items: [
          {
            title: 'container',
            url: '#',
            items: [{ title: 'child', url: '/dashboard/worlds/:worldId/story' }]
          }
        ]
      }
    ];
    const actions = navigationCommands(resolveWorldNavigation(groups, null), navigate);
    expect(actions).toHaveLength(1);
    actions[0].perform();
    expect(navigate).toHaveBeenCalledWith('/dashboard/overview');
  });

  it('excludes disabled and external router actions', () => {
    const groups = [
      {
        label: 'group',
        items: [
          { title: 'disabled', url: '/disabled', disabled: true },
          { title: 'external', url: 'https://example.com', external: true }
        ]
      }
    ];
    expect(navigationCommands(groups, vi.fn())).toEqual([]);
  });

  it('keeps all configured keyboard sequences unambiguous', () => {
    const actions = [
      ...navigationCommands(resolveWorldNavigation(navGroups, null), vi.fn()),
      commands[0]
    ];
    const shortcuts = actions
      .filter((action) => action.shortcut)
      .map((action) => action.shortcut!.join(' '));
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });
});

describe('command palette shortcut decisions', () => {
  it.each(['metaKey', 'ctrlKey'])('opens and closes with %s + K even in an input', (modifier) => {
    expect(
      matchPaletteShortcut(
        null,
        { key: 'k', [modifier]: true, editable: true },
        commands,
        10,
        false
      )
    ).toEqual({ next: null, toggle: true });
    expect(matchPaletteShortcut(null, { key: 'k', [modifier]: true }, commands, 10, true)).toEqual({
      next: null,
      toggle: true
    });
  });

  it('matches D D and G W within the sequence window', () => {
    const first = matchPaletteShortcut(null, { key: 'D' }, commands, 100, false);
    expect(matchPaletteShortcut(first.next, { key: 'd' }, commands, 200, false).commandId).toBe(
      'theme'
    );
    expect(
      matchPaletteShortcut({ key: 'g', at: 100 }, { key: 'w' }, commands, 200, false).commandId
    ).toBe('worlds');
  });

  it('rejects expired and non-monotonic sequences', () => {
    expect(
      matchPaletteShortcut({ key: 'd', at: 100 }, { key: 'd' }, commands, 901, false).commandId
    ).toBeUndefined();
    expect(
      matchPaletteShortcut({ key: 'd', at: 100 }, { key: 'd' }, commands, 50, false).commandId
    ).toBeUndefined();
  });

  it.each([
    'editable',
    'repeat',
    'isComposing',
    'defaultPrevented',
    'altKey',
    'ctrlKey',
    'metaKey',
    'shiftKey'
  ])('does not consume a sequence when %s is set', (flag) => {
    expect(
      matchPaletteShortcut({ key: 'd', at: 100 }, { key: 'd', [flag]: true }, commands, 200, false)
    ).toEqual({ next: null });
  });

  it('does not run global sequences while the palette is open', () => {
    expect(matchPaletteShortcut({ key: 'd', at: 100 }, { key: 'd' }, commands, 200, true)).toEqual({
      next: null
    });
  });
});
