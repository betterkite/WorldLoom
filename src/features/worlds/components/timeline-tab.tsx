'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { lintQueryOptions, relationsAtQueryOptions, timelineQueryOptions } from '../api/queries';
import { runLintMutation } from '../api/mutations';
import type { TimelineEvent } from '../api/service';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { toast } from 'sonner';

/**
 * Chronicle timeline (Phase 3): epoch segments on a horizontal track, event
 * cards in chronological order, causal edges drawn as SVG curves between
 * cards, plus a relationship time-slice viewer (fold as of a chosen event).
 */

export function TimelineTab({ worldId }: { worldId: string }) {
  const [participant, setParticipant] = useState<string | null>(null);
  const { data } = useSuspenseQuery(timelineQueryOptions(worldId, participant));

  const trackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [edgePaths, setEdgePaths] = useState<{ d: string; key: string }[]>([]);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const paths: { d: string; key: string }[] = [];
    for (const edge of data.edges) {
      const from = cardRefs.current.get(edge.causeUid);
      const to = cardRefs.current.get(edge.effectUid);
      if (!from || !to) continue;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const base = track.getBoundingClientRect();
      const x1 = a.right - base.left + track.scrollLeft;
      const y1 = a.top - base.top + a.height / 2;
      const x2 = b.left - base.left + track.scrollLeft;
      const y2 = b.top - base.top + b.height / 2;
      const mid = (x1 + x2) / 2;
      paths.push({
        key: `${edge.causeUid}->${edge.effectUid}`,
        d: `M ${x1} ${y1} C ${mid} ${y1 - 26}, ${mid} ${y2 - 26}, ${x2} ${y2}`
      });
    }
    setEdgePaths(paths);
  }, [data]);

  return (
    <div className='space-y-5 overflow-hidden'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-xs text-muted-foreground'>参与者筛选</span>
        <div className='flex flex-wrap gap-1'>
          <Button
            size='sm'
            variant={participant === null ? 'default' : 'outline'}
            onClick={() => setParticipant(null)}
          >
            全部
          </Button>
          {data.entityIndex.slice(0, 12).map((entity) => (
            <Button
              key={entity.uid}
              size='sm'
              variant={participant === entity.uid ? 'default' : 'outline'}
              onClick={() => setParticipant(entity.uid)}
            >
              {entity.name}
            </Button>
          ))}
        </div>
      </div>

      <div
        className='overflow-auto w-full rounded-lg border bg-muted/20 p-4 max-h-[60vh]'
        ref={trackRef}
      >
        <div className='relative min-w-max'>
          <svg
            className='pointer-events-none absolute inset-0 h-full w-full'
            style={{ zIndex: 10 }}
          >
            <defs>
              <marker
                id='arrow'
                viewBox='0 0 8 8'
                refX='7'
                refY='4'
                markerWidth='7'
                markerHeight='7'
                orient='auto'
              >
                <path d='M 0 0 L 8 4 L 0 8 z' fill='hsl(var(--primary))' />
              </marker>
            </defs>
            {edgePaths.map((path) => (
              <path
                key={path.key}
                d={path.d}
                fill='none'
                stroke='hsl(var(--primary))'
                strokeWidth='1.5'
                strokeDasharray='4 3'
                markerEnd='url(#arrow)'
                opacity='0.7'
              />
            ))}
          </svg>
          <div className='flex flex-col gap-8'>
            {data.segments.map((segment) => (
              <section key={segment.epochUid ?? 'none'} className='min-w-max'>
                <div className='mb-3 flex items-center gap-2 border-b pb-2'>
                  <span className='text-sm font-semibold'>{segment.epochName}</span>
                  {segment.minYear !== null && (
                    <span className='text-xs text-muted-foreground'>
                      {segment.minYear}
                      {segment.maxYear !== null && segment.maxYear !== segment.minYear
                        ? ` – ${segment.maxYear}`
                        : ''}{' '}
                      年
                    </span>
                  )}
                  <Badge variant='outline' className='ml-1'>
                    {segment.events.length}
                  </Badge>
                </div>
                <div className='flex flex-col gap-3 border-t-2 border-dashed pt-3'>
                  {segment.events.map((event) => (
                    <EventCard
                      key={event.uid}
                      event={event}
                      onCardRef={(node) => {
                        if (node) cardRefs.current.set(event.uid, node);
                        else cardRefs.current.delete(event.uid);
                      }}
                    />
                  ))}
                </div>
              </section>
            ))}
            {data.segments.length === 0 && (
              <p className='py-10 text-center text-sm text-muted-foreground'>
                编年史还是空的——去「素材」或「创世向导」生成事件。
              </p>
            )}
          </div>
        </div>
      </div>

      <RelationsSnapshot worldId={worldId} events={data.segments.flatMap((s) => s.events)} />
    </div>
  );
}

function EventCard({
  event,
  onCardRef
}: {
  event: TimelineEvent;
  onCardRef: (node: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={onCardRef}
      className='w-full rounded-lg border bg-background p-2.5 shadow-sm'
      style={{ zIndex: 20 }}
    >
      <div className='flex items-center justify-between gap-1'>
        {event.year !== null ? (
          <span className='text-[10px] font-semibold text-primary'>{event.year} 年</span>
        ) : (
          <span />
        )}
        <span className='text-[10px] text-muted-foreground'>{event.confidence}</span>
      </div>
      <div className='mt-1 text-xs font-medium leading-snug'>{event.title}</div>
      {event.participantNames.length > 0 && (
        <div className='mt-1 truncate text-[10px] text-muted-foreground'>
          {event.participantNames.join(' · ')}
        </div>
      )}
      {(event.causes.length > 0 || event.effects.length > 0) && (
        <div className='mt-1 text-[10px] text-muted-foreground'>
          {event.causes.length > 0 && <div>⇠ {event.causes.length} 起因</div>}
          {event.effects.length > 0 && <div>⇒ {event.effects.length} 结果</div>}
        </div>
      )}
    </div>
  );
}

function RelationsSnapshot({ worldId, events }: { worldId: string; events: TimelineEvent[] }) {
  const [atEvent, setAtEvent] = useState<string | null>(null);
  const { data } = useSuspenseQuery(relationsAtQueryOptions(worldId, atEvent));
  const lint = useSuspenseQuery(lintQueryOptions(worldId));
  const runLint = useMutation({
    ...runLintMutation(worldId),
    onSuccess: (r) => toast.success(`体检完成：${r.counts.error} 错误 / ${r.counts.warning} 警告`),
    onError: (e: Error) => toast.error(e.message)
  });

  return (
    <div className='space-y-3 rounded-lg border p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-sm font-semibold'>关系快照</span>
        <span className='text-xs text-muted-foreground'>折叠到选定时刻（事件溯源）</span>
        <select
          className='ml-auto rounded-md border bg-background px-2 py-1 text-xs'
          value={atEvent ?? ''}
          onChange={(e) => setAtEvent(e.target.value || null)}
          aria-label='选择时刻'
        >
          <option value=''>当前主版本</option>
          {events.toReversed().map((event) => (
            <option key={event.uid} value={event.uid}>
              {event.epochName} {event.year !== null ? `${event.year} 年 · ` : ''}
              {event.title}
            </option>
          ))}
        </select>
      </div>
      {data.asOf.title && (
        <p className='text-xs text-muted-foreground'>
          时刻：「{data.asOf.title}」（sort {data.asOf.sortOrder}）
        </p>
      )}
      <div className='flex flex-wrap gap-2'>
        {data.edges.map((edge, index) => (
          <span
            key={`${edge.subjectUid}-${edge.objectUid}-${edge.relation}-${index}`}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
              edge.active
                ? 'border-primary/30 bg-primary/5'
                : 'border-muted-foreground/30 text-muted-foreground line-through'
            }`}
          >
            <strong>{edge.subjectName}</strong>
            <span className='text-muted-foreground'>
              —{edge.relation}
              {edge.polarity === 'weaken' ? '(弱化)' : ''}→
            </span>
            <strong>{edge.objectName}</strong>
          </span>
        ))}
        {data.edges.length === 0 && (
          <p className='text-xs text-muted-foreground'>
            该时刻没有已折叠的关系。用条目/事件变更（relation_upsert）推进关系。
          </p>
        )}
      </div>
      <div className='flex items-center gap-2 border-t pt-3'>
        <span className='text-sm font-semibold'>一致性体检</span>
        <Button
          size='sm'
          variant='outline'
          disabled={runLint.isPending}
          onClick={() => runLint.mutate()}
        >
          {runLint.isPending ? (
            <Icons.spinner className='h-4 w-4 animate-spin' />
          ) : (
            <Icons.check className='h-4 w-4' />
          )}
          运行体检
        </Button>
        <span className='text-xs text-muted-foreground'>
          {lint.data.findings.filter((f) => f.status === 'open').length} 条待处理 ·
          详细列表见「一致性检查」标签页
        </span>
      </div>
    </div>
  );
}
