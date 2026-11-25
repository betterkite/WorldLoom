'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useThemeConfig } from '@/components/themes/active-theme';
import { THEMES } from '@/components/themes/theme.config';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { useWorldNavigation } from '@/hooks/use-world-navigation';
import {
  matchPaletteShortcut,
  navigationCommands,
  type PaletteCommand,
  type ShortcutState
} from '@/lib/command-palette';

const PaletteContext = createContext<(() => void) | null>(null);

export function useCommandPalette() {
  const toggle = useContext(PaletteContext);
  if (!toggle) throw new Error('useCommandPalette requires CommandPaletteProvider');
  return toggle;
}

export default function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const sequence = useRef<ShortcutState>(null);
  const router = useRouter();
  const groups = useWorldNavigation();
  const { resolvedTheme, setTheme } = useTheme();
  const { activeTheme, setActiveTheme } = useThemeConfig();
  const toggle = useCallback(() => {
    if (!open) {
      previousFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setOpen((current) => !current);
  }, [open]);

  const commands: PaletteCommand[] = useMemo(
    () => [
      ...navigationCommands(groups, (url) => router.push(url)),
      {
        id: 'theme:cycle',
        name: '切换配色主题',
        section: '外观',
        shortcut: ['t', 't'],
        perform: () => {
          const index = THEMES.findIndex((theme) => theme.value === activeTheme);
          setActiveTheme(THEMES[(index + 1) % THEMES.length].value);
        }
      },
      {
        id: 'theme:toggle',
        name: '切换明暗模式',
        section: '外观',
        shortcut: ['d', 'd'],
        perform: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
      },
      {
        id: 'theme:light',
        name: '使用浅色模式',
        section: '外观',
        perform: () => setTheme('light')
      },
      { id: 'theme:dark', name: '使用深色模式', section: '外观', perform: () => setTheme('dark') }
    ],
    [groups, router, activeTheme, resolvedTheme, setActiveTheme, setTheme]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Do not steal sequences from another modal (e.g. a manuscript editor).
      if (!open && document.querySelector('[role="dialog"][aria-modal="true"]')) {
        sequence.current = null;
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const match = matchPaletteShortcut(
        sequence.current,
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          repeat: event.repeat,
          isComposing: event.isComposing,
          defaultPrevented: event.defaultPrevented,
          editable: Boolean(
            target?.closest(
              'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'
            )
          )
        },
        commands,
        performance.now(),
        open
      );
      sequence.current = match.next;
      if (match.toggle) {
        event.preventDefault();
        toggle();
      } else if (match.commandId) {
        event.preventDefault();
        commands.find((command) => command.id === match.commandId)?.perform();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commands, open, toggle]);

  const sections = [...new Set(commands.map((command) => command.section))];
  return (
    <PaletteContext.Provider value={toggle}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className='top-[14vh] translate-y-0 gap-0 p-0 sm:max-w-[600px]'
          showCloseButton={false}
          finalFocus={() =>
            previousFocus.current?.isConnected
              ? previousFocus.current
              : document.getElementById('main-content')
          }
        >
          <DialogTitle className='sr-only'>命令面板</DialogTitle>
          <DialogDescription className='sr-only'>
            搜索页面或外观命令，使用方向键选择，回车执行。
          </DialogDescription>
          <Command label='搜索命令' loop>
            <CommandInput placeholder='搜索页面或命令...' aria-label='搜索命令' />
            <CommandList className='max-h-[min(400px,60vh)]'>
              <CommandEmpty>没有找到匹配的命令。</CommandEmpty>
              {sections.map((section) => (
                <CommandGroup key={section} heading={section}>
                  {commands
                    .filter((command) => command.section === section)
                    .map((command) => (
                      <CommandItem
                        key={command.id}
                        value={command.id}
                        keywords={[command.name, section]}
                        onSelect={() => {
                          setOpen(false);
                          command.perform();
                        }}
                      >
                        {command.name}
                        {command.shortcut && (
                          <CommandShortcut>
                            {command.shortcut.map((key, index) => (
                              <Kbd key={`${key}-${index}`}>{key.toUpperCase()}</Kbd>
                            ))}
                          </CommandShortcut>
                        )}
                      </CommandItem>
                    ))}
                </CommandGroup>
              ))}
            </CommandList>
            <div className='text-muted-foreground flex gap-3 border-t px-3 py-2 text-xs'>
              <span>↑ ↓ 选择</span>
              <span>↵ 执行</span>
              <span>Esc 关闭</span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </PaletteContext.Provider>
  );
}
