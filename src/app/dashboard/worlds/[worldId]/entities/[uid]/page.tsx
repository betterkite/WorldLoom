import PageContainer from '@/components/layout/page-container';
import { ClientOnly } from '@/components/client-only';
import { EntityDetail } from '@/features/worlds/components/entity-detail';

export const metadata = { title: 'WorldLoom: 条目详情' };

type PageProps = { params: Promise<{ worldId: string; uid: string }> };

export default async function Page(props: PageProps) {
  const { worldId, uid } = await props.params;
  return (
    <PageContainer>
      <ClientOnly>
        <EntityDetail worldId={worldId} uid={uid} />
      </ClientOnly>
    </PageContainer>
  );
}
