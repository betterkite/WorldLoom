import type { NavGroup, NavItem } from '@/types';

export type PaletteCommand = {
  id: string;
  name: string;
  section: string;
  shortcut?: readonly string[];
  perform: () => void;
};

export function resolveWorldNavigation(groups: NavGroup[], worldId: string | null): NavGroup[] {
  const resolve = (item: NavItem): NavItem => ({
    ...item,
    url: item.url.includes(':worldId')
      ? worldId
        ? item.url.replace(':worldId', encodeURIComponent(worldId))
        : '/dashboard/overview'
      : item.url,
    items: item.items?.map(resolve)
  });
  return groups.map((group) => ({ ...group, items: group.items.map(resolve) }));
}

export function navigationCommands(
  groups: NavGroup[],
  navigate: (url: string) => void
): PaletteCommand[] {
  const visit = (items: NavItem[], section: string): PaletteCommand[] =>
    items.flatMap((item) => {
      // Container, disabled and external entries must not become router actions.
      const command =
        item.url !== '#' && !item.disabled && !item.external
          ? [
              {
                id: `navigate:${section}:${item.title}`,
                name: item.title,
                section,
                shortcut: item.shortcut,
                perform: () => navigate(item.url)
              }
            ]
          : [];
      return [...command, ...visit(item.items ?? [], item.title)];
    });
  return groups.flatMap((group) => visit(group.items, group.label));
}

export type ShortcutState = { key: string; at: number } | null;
export type ShortcutEvent = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  editable?: boolean;
};

/** Pure decision logic: sequences never consume typing or IME composition. */
export function matchPaletteShortcut(
  previous: ShortcutState,
  event: ShortcutEvent,
  commands: PaletteCommand[],
  now: number,
  open: boolean
): { next: ShortcutState; toggle?: true; commandId?: string } {
  if (event.defaultPrevented || event.isComposing || event.repeat) return { next: null };
  const key = event.key.toLowerCase();
  if (key === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
    return { next: null, toggle: true };
  }
  if (open || event.editable || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return { next: null };
  }
  const command = commands.find(
    (item) =>
      item.shortcut?.length === 2 &&
      previous &&
      now - previous.at <= 800 &&
      now >= previous.at &&
      item.shortcut[0] === previous.key &&
      item.shortcut[1] === key
  );
  if (command) return { next: null, commandId: command.id };
  return {
    next: commands.some((item) => item.shortcut?.[0] === key) ? { key, at: now } : null
  };
}
