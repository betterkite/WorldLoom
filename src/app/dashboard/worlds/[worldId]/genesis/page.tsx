import PageContainer from '@/components/layout/page-container';
import { ClientOnly } from '@/components/client-only';
import { GenesisTab } from '@/features/worlds/components/world-detail';
import { getWorld } from '@/lib/worldbuilding/worlds';

export const metadata = { title: 'WorldLoom: 创世向导' };

type PageProps = { params: Promise<{ worldId: string }> };

export default async function Page(props: PageProps) {
  const { worldId } = await props.params;
  const world = await getWorld(worldId);
  return (
    <PageContainer>
      <ClientOnly>
        <GenesisTab worldId={worldId} premise={world.premise} style={world.style} />
      </ClientOnly>
    </PageContainer>
  );
}
