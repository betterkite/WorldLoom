import PageContainer from '@/components/layout/page-container';
import { ClientOnly } from '@/components/client-only';
import { EvalsView } from '@/features/evals/components/evals-view';

export const metadata = { title: 'WorldLoom: 评测平台' };

export default function EvalsPage() {
  return (
    <PageContainer>
      <ClientOnly fallback={<div className='p-8 text-sm text-muted-foreground'>加载中…</div>}>
        <EvalsView />
      </ClientOnly>
    </PageContainer>
  );
}
