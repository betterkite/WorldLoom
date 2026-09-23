'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: '工作台',
  overview: '总览',
  worlds: '世界',
  entities: '设定条目',
  events: '编年史',
  timeline: '时间线',
  story: '故事创作',
  assistant: '世界知识助手',
  graph: '图谱',
  genesis: '创世向导',
  review: '审阅',
  lint: '一致性检查',
  manuscript: '编年创作',
  sources: '设定素材',
  ops: '运行治理',
  versions: '版本',
  evals: '评测',
  skills: '能力中心'
};

export function useBreadcrumbs() {
  const pathname = usePathname();

  const breadcrumbs = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);
    return segments.map((segment, index) => {
      const path = `/${segments.slice(0, index + 1).join('/')}`;
      const isWorldId = segments[index - 1] === 'worlds' && !SEGMENT_LABELS[segment];
      return {
        title: SEGMENT_LABELS[segment] ?? (isWorldId ? '当前世界' : segment),
        link: path
      };
    });
  }, [pathname]);

  return breadcrumbs;
}
