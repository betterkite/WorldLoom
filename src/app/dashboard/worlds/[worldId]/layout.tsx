import { getWorld } from '@/lib/worldbuilding/worlds';
import { WorldNav } from '@/components/layout/world-nav';
import { Badge } from '@/components/ui/badge';

export default async function WorldLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ worldId: string }>;
}) {
  const { worldId } = await params;
  const world = await getWorld(worldId).catch(() => null);
  return (
    <div className='space-y-4 px-4 py-4 md:px-8'>
      <div className='flex flex-wrap items-center gap-3'>
        <h1 className='text-2xl font-semibold'>{world?.name ?? '世界'}</h1>
        {world && <Badge>v{world.masterVersion}</Badge>}
        {world && world.pendingChanges > 0 && (
          <Badge variant='destructive'>{world.pendingChanges} 待审</Badge>
        )}
      </div>
      <WorldNav worldId={worldId} />
      {children}
    </div>
  );
}
