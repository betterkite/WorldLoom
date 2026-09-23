import PageContainer from '@/components/layout/page-container';
import { ClientOnly } from '@/components/client-only';
import { AssistantTab } from '@/features/worlds/components/assistant-tab';

export const metadata = { title: 'WorldLoom: 创作助手' };

type PageProps = { params: Promise<{ worldId: string }> };

export default async function Page(props: PageProps) {
  const { worldId } = await props.params;
  return (
    <PageContainer>
      <ClientOnly>
        <AssistantTab worldId={worldId} />
      </ClientOnly>
    </PageContainer>
  );
}
