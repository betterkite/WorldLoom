'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Icons } from '@/components/icons';

type EntityDetail = {
  uid: string;
  kind: string;
  name: string;
  aliases: string[];
  summary: string;
  content: string;
  confidence: string;
  tags: string[];
  version: number;
  relations: {
    uid: string;
    subjectUid: string;
    objectUid: string;
    relation: string;
    polarity: string;
    note: string;
    eventUid: string | null;
  }[];
};

export function EntityDetail({ worldId, uid }: { worldId: string; uid: string }) {
  const entity = useQuery({
    queryKey: ['entity', worldId, uid],
    queryFn: async () => {
      const response = await fetch(`/api/worlds/${worldId}/entities/${uid}`);
      if (!response.ok) throw new Error('条目不存在或不在当前主版本');
      return (await response.json()) as { entity: EntityDetail };
    }
  });
  const index = useQuery({
    queryKey: ['entity-index', worldId],
    queryFn: async () => {
      const response = await fetch(`/api/worlds/${worldId}/entities`);
      const payload = (await response.json()) as { entities: { uid: string; name: string }[] };
      return new Map(payload.entities.map((e) => [e.uid, e.name]));
    }
  });

  if (entity.isLoading) return <p className='p-8 text-sm text-muted-foreground'>加载中…</p>;
  if (entity.error || !entity.data)
    return (
      <p className='p-8 text-sm text-destructive'>
        {(entity.error as Error)?.message ?? '加载失败'}
      </p>
    );

  const data = entity.data.entity;
  const nameOf = (targetUid: string) => index.data?.get(targetUid) ?? targetUid;

  return (
    <div className='space-y-4'>
      <Link
        href={`/dashboard/worlds/${worldId}/entities`}
        className='inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-2 hover:underline'
      >
        <Icons.chevronLeft className='h-4 w-4' /> 返回条目列表
      </Link>

      <div className='flex flex-wrap items-center gap-2'>
        <h2 className='text-xl font-semibold'>{data.name}</h2>
        <Badge variant='outline'>{data.kind}</Badge>
        <Badge variant='secondary'>{data.confidence}</Badge>
        <span className='text-xs text-muted-foreground'>
          v{data.version} · {data.uid}
        </span>
      </div>

      {data.aliases.length > 0 && (
        <p className='text-xs text-muted-foreground'>别名：{data.aliases.join('、')}</p>
      )}
      {data.tags.length > 0 && (
        <div className='flex flex-wrap gap-1'>
          {data.tags.map((tag) => (
            <Badge key={tag} variant='outline' className='text-xs'>
              #{tag}
            </Badge>
          ))}
        </div>
      )}

      {data.summary && <p className='rounded-lg border bg-muted/20 p-3 text-sm'>{data.summary}</p>}
      {data.content && (
        <pre className='whitespace-pre-wrap rounded-lg border p-4 text-sm leading-relaxed'>
          {data.content}
        </pre>
      )}

      <div className='space-y-2 rounded-lg border p-4'>
        <p className='text-sm font-semibold'>关系（{data.relations.length}）</p>
        {data.relations.map((relation) => (
          <div key={relation.uid} className='flex flex-wrap items-center gap-2 text-sm'>
            <Badge
              variant={relation.polarity === 'terminate' ? 'destructive' : 'secondary'}
              className='text-xs'
            >
              {relation.polarity}
            </Badge>
            <Link
              className='underline-offset-2 hover:underline'
              href={`/dashboard/worlds/${worldId}/entities/${relation.subjectUid}`}
            >
              {nameOf(relation.subjectUid)}
            </Link>
            <span className='text-muted-foreground'>—{relation.relation}→</span>
            <Link
              className='underline-offset-2 hover:underline'
              href={`/dashboard/worlds/${worldId}/entities/${relation.objectUid}`}
            >
              {nameOf(relation.objectUid)}
            </Link>
            {relation.note && (
              <span className='text-xs text-muted-foreground'>（{relation.note}）</span>
            )}
          </div>
        ))}
        {data.relations.length === 0 && (
          <p className='text-xs text-muted-foreground'>
            尚无关系事件。可用「设定条目」或推演采纳来推进关系。
          </p>
        )}
      </div>
    </div>
  );
}
