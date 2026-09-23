import PageContainer from '@/components/layout/page-container';
import { ClientOnly } from '@/components/client-only';
import { EntitiesTab } from '@/features/worlds/components/world-detail';

export const metadata = { title: 'WorldLoom: 设定条目' };

type PageProps = { params: Promise<{ worldId: string }> };

export default async function Page(props: PageProps) {
  const { worldId } = await props.params;
  return (
    <PageContainer>
      <ClientOnly>
        <EntitiesTab worldId={worldId} />
      </ClientOnly>
    </PageContainer>
  );
}
