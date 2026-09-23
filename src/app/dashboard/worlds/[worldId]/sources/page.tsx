import PageContainer from '@/components/layout/page-container';
import { ClientOnly } from '@/components/client-only';
import { SourcesTab } from '@/features/worlds/components/world-detail';

export const metadata = { title: 'WorldLoom: 素材' };

type PageProps = { params: Promise<{ worldId: string }> };

export default async function Page(props: PageProps) {
  const { worldId } = await props.params;
  return (
    <PageContainer>
      <ClientOnly>
        <SourcesTab worldId={worldId} />
      </ClientOnly>
    </PageContainer>
  );
}
