import PageContainer from '@/components/layout/page-container';
import { ClientOnly } from '@/components/client-only';
import { TimelineTab } from '@/features/worlds/components/timeline-tab';

export const metadata = { title: 'WorldLoom: 时间线' };

type PageProps = { params: Promise<{ worldId: string }> };

export default async function Page(props: PageProps) {
  const { worldId } = await props.params;
  return (
    <PageContainer>
      <ClientOnly>
        <TimelineTab worldId={worldId} />
      </ClientOnly>
    </PageContainer>
  );
}
