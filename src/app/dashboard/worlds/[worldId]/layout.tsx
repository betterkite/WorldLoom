import { WorldNav } from '@/components/layout/world-nav';
import { WorldStatusHeader } from '@/components/layout/world-status-header';
import { getWorldOrNotFound } from './get-world-or-not-found';

export default async function WorldLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ worldId: string }>;
}) {
  const { worldId } = await params;
  const world = await getWorldOrNotFound(worldId);
  return (
    <div className='space-y-4 px-4 py-4 md:px-8'>
      <WorldStatusHeader
        initialWorld={{
          id: world.id,
          name: world.name,
          masterVersion: world.masterVersion,
          pendingChanges: world.pendingChanges
        }}
      />
      <WorldNav worldId={worldId} />
      {children}
    </div>
  );
}
