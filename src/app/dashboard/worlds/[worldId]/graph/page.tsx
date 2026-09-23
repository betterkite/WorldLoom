import PageContainer from '@/components/layout/page-container';
import { ClientOnly } from '@/components/client-only';
import { GraphTab } from '@/features/worlds/components/graph-tab';

export const metadata = { title: 'WorldLoom: 图谱' };

type PageProps = { params: Promise<{ worldId: string }> };

export default async function Page(props: PageProps) {
  const { worldId } = await props.params;
  return (
    <PageContainer>
      <ClientOnly>
        <GraphTab worldId={worldId} />
      </ClientOnly>
    </PageContainer>
  );
}
