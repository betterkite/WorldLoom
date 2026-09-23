import { WorldsHome } from '@/features/worlds/components/worlds-home';
import { ClientOnly } from '@/components/client-only';

export const metadata = { title: 'WorldLoom: 世界总览' };

export default function OverviewPage() {
  return (
    <ClientOnly fallback={<div className='p-8 text-sm text-muted-foreground'>加载中…</div>}>
      <WorldsHome />
    </ClientOnly>
  );
}
