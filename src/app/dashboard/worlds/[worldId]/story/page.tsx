import PageContainer from '@/components/layout/page-container';
import { ClientOnly } from '@/components/client-only';
import { StoryStudio } from '@/features/worlds/components/story-studio';

export const metadata = { title: 'WorldLoom: 故事创作' };

type PageProps = { params: Promise<{ worldId: string }> };

export default async function Page(props: PageProps) {
  const { worldId } = await props.params;
  return (
    <PageContainer>
      <ClientOnly>
        <StoryStudio worldId={worldId} />
      </ClientOnly>
    </PageContainer>
  );
}
