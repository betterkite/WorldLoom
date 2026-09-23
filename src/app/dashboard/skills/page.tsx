import PageContainer from '@/components/layout/page-container';
import { ClientOnly } from '@/components/client-only';
import { SkillsView } from '@/features/skills/components/skills-view';

export const metadata = { title: 'WorldLoom: 能力中心' };

export default function SkillsPage() {
  return (
    <PageContainer>
      <ClientOnly fallback={<div className='p-8 text-sm text-muted-foreground'>加载中…</div>}>
        <SkillsView />
      </ClientOnly>
    </PageContainer>
  );
}
