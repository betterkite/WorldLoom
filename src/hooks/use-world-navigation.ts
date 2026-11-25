'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { navGroups } from '@/config/nav-config';
import { worldsQueryOptions } from '@/features/worlds/api/queries';
import { useFilteredNavGroups } from '@/hooks/use-nav';
import { resolveWorldNavigation } from '@/lib/command-palette';

const LAST_WORLD_KEY = 'worldloom:lastWorld';
const STORAGE_CHANGED = 'worldloom:world-navigation';

function readSavedWorld() {
  try {
    return window.localStorage.getItem(LAST_WORLD_KEY);
  } catch {
    return null;
  }
}

function subscribeSavedWorld(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(STORAGE_CHANGED, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(STORAGE_CHANGED, onChange);
  };
}

const noSavedWorldOnServer = () => null;

/** Share validated destinations between the sidebar and command palette. */
export function useWorldNavigation() {
  const pathname = usePathname();
  const currentWorldId = pathname?.match(/\/dashboard\/worlds\/([^/]+)/)?.[1];
  const storedId = useSyncExternalStore(subscribeSavedWorld, readSavedWorld, noSavedWorldOnServer);
  const groups = useFilteredNavGroups(navGroups);
  const { data, isError } = useQuery({
    ...worldsQueryOptions(),
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always'
  });

  const currentWorld = data?.worlds.find((world) => world.id === currentWorldId);
  const storedWorld = data?.worlds.find((world) => world.id === storedId);

  useEffect(() => {
    if (!data || isError) return;
    try {
      if (currentWorld && storedId !== currentWorld.id) {
        window.localStorage.setItem(LAST_WORLD_KEY, currentWorld.id);
        window.dispatchEvent(new Event(STORAGE_CHANGED));
      } else if (storedId && !storedWorld) {
        window.localStorage.removeItem(LAST_WORLD_KEY);
        window.dispatchEvent(new Event(STORAGE_CHANGED));
      }
    } catch {
      // A blocked storage API must not break navigation.
    }
  }, [currentWorld, data, isError, storedId, storedWorld]);

  const worldId = isError
    ? null
    : (currentWorld?.id ?? storedWorld?.id ?? data?.worlds[0]?.id ?? null);
  return resolveWorldNavigation(groups, worldId);
}
