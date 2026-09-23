import PageContainer from '@/components/layout/page-container';
import { ClientOnly } from '@/components/client-only';
import { OpsTab } from '@/features/worlds/components/ops-tab';

export const metadata = { title: 'WorldLoom: 运行治理' };

type PageProps = { params: Promise<{ worldId: string }> };

export default async function Page(props: PageProps) {
  const { worldId } = await props.params;
  return (
    <PageContainer>
      <ClientOnly>
        <OpsTab worldId={worldId} />
      </ClientOnly>
    </PageContainer>
  );
}
