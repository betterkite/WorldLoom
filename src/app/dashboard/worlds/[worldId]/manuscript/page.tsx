import PageContainer from '@/components/layout/page-container';
import { ClientOnly } from '@/components/client-only';
import { ManuscriptTab } from '@/features/worlds/components/manuscript-tab';

export const metadata = { title: 'WorldLoom: 作品创作台' };

type PageProps = { params: Promise<{ worldId: string }> };

export default async function Page(props: PageProps) {
  const { worldId } = await props.params;
  return (
    <PageContainer>
      <ClientOnly>
        <ManuscriptTab worldId={worldId} />
      </ClientOnly>
    </PageContainer>
  );
}
