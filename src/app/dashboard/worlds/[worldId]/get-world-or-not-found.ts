import { GovernanceError } from '@/lib/governance/changes';
import { getWorld } from '@/lib/worldbuilding/worlds';
import { notFound } from 'next/navigation';
import { cache } from 'react';

export const getWorldOrNotFound = cache(async (worldId: string) => {
  try {
    return await getWorld(worldId);
  } catch (error) {
    if (error instanceof GovernanceError && error.code === 'world_not_found') notFound();
    throw error;
  }
});
