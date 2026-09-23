import PageContainer from '@/components/layout/page-container';
import { ClientOnly } from '@/components/client-only';
import { LintTab } from '@/features/worlds/components/lint-tab';

export const metadata = { title: 'WorldLoom: 一致性检查' };

type PageProps = { params: Promise<{ worldId: string }> };

export default async function Page(props: PageProps) {
  const { worldId } = await props.params;
  return (
    <PageContainer>
      <ClientOnly>
        <LintTab worldId={worldId} />
      </ClientOnly>
    </PageContainer>
  );
}
