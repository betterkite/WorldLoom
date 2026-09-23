'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { segment: 'entities', label: '设定条目' },
  { segment: 'timeline', label: '时间线' },
  { segment: 'story', label: '故事创作' },
  { segment: 'events', label: '编年史' },
  { segment: 'assistant', label: '世界知识助手' },
  { segment: 'graph', label: '图谱' },
  { segment: 'genesis', label: '创世向导' },
  { segment: 'review', label: '审阅' },
  { segment: 'lint', label: '一致性检查' },
  { segment: 'versions', label: '版本' }
];

export function WorldNav({ worldId }: { worldId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/worlds/${worldId}`;
  return (
    <nav className='flex flex-wrap gap-1 border-b pb-2' aria-label='世界工作台导航'>
      {ITEMS.map((item) => {
        const active = pathname === `${base}/${item.segment}`;
        return (
          <Link
            key={item.segment}
            href={`${base}/${item.segment}`}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
