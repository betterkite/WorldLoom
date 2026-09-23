'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import {
  entitiesQueryOptions,
  epochsQueryOptions,
  eventsQueryOptions,
  sourcesQueryOptions,
  versionsQueryOptions,
  worldKeys
} from '../api/queries';
import {
  compileSourceMutation,
  createSourceMutation,
  commitGenesisMutation,
  deleteChangeMutation,
  deleteEntityChangeMutation,
  mergeWorldMutation,
  planGenesisMutation,
  rollbackVersionMutation,
  submitEntityChangeMutation,
  submitEventChangeMutation
} from '../api/mutations';
import { fetchCompileRun, type GenesisPlan } from '../api/service';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertModal } from '@/components/modal/alert-modal';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Icons } from '@/components/icons';
import { toast } from 'sonner';
import type { EntityRow } from '../api/types';

const KIND_LABELS: Record<string, string> = {
  character: '角色',
  location: '地点',
  organization: '组织',
  species: '物种',
  item: '物品',
  concept: '概念',
  rule: '规则',
  faction: '势力'
};

const COMPILE_CHUNK_STATUS_LABELS: Record<string, string> = {
  pending: '等待中',
  analyzing: '分析中',
  generating: '生成中',
  completed: '已完成',
  failed: '失败'
};

function formatReviewJson(value: unknown) {
  return JSON.stringify(value, null, 2) ?? '—';
}

type ReviewDiffRow = {
  path: string;
  candidate: unknown;
  current: unknown;
};

const MAX_REVIEW_DIFF_ROWS = 80;

function isReviewRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function collectReviewDiff(
  candidate: unknown,
  current: unknown,
  path: string,
  rows: ReviewDiffRow[]
) {
  if (rows.length >= MAX_REVIEW_DIFF_ROWS) return;
  if (isReviewRecord(candidate) && isReviewRecord(current)) {
    const keys = new Set([...Object.keys(candidate), ...Object.keys(current)]);
    for (const key of [...keys].toSorted()) {
      collectReviewDiff(
        candidate[key],
        current[key],
        path === 'root' ? key : `${path}.${key}`,
        rows
      );
      if (rows.length >= MAX_REVIEW_DIFF_ROWS) return;
    }
    return;
  }
  if (Array.isArray(candidate) && Array.isArray(current)) {
    const length = Math.max(candidate.length, current.length);
    for (let index = 0; index < length; index += 1) {
      collectReviewDiff(candidate[index], current[index], `${path}[${index}]`, rows);
      if (rows.length >= MAX_REVIEW_DIFF_ROWS) return;
    }
    return;
  }
  if (formatReviewJson(candidate) !== formatReviewJson(current)) {
    rows.push({ path, candidate, current });
  }
}

function reviewDiffRows(candidate: unknown, current: unknown) {
  if (candidate === null || candidate === undefined) return [];
  const rows: ReviewDiffRow[] = [];
  collectReviewDiff(candidate, current, 'root', rows);
  return rows;
}

export function EntitiesTab({ worldId }: { worldId: string }) {
  const { data } = useSuspenseQuery(entitiesQueryOptions(worldId));
  const [createOpen, setCreateOpen] = useState(false);
  const submit = useMutation({
    ...submitEntityChangeMutation(worldId),
    onSuccess: () => {
      toast.success('已提交审阅');
      setCreateOpen(false);
    },
    onError: (e: Error) => toast.error(e.message)
  });
  const remove = useMutation({
    ...deleteEntityChangeMutation(worldId),
    onSuccess: () => toast.success('已提交删除审阅'),
    onError: (e: Error) => toast.error(e.message)
  });
  const [pendingDelete, setPendingDelete] = useState<EntityRow | null>(null);

  return (
    <div className='space-y-3'>
      <div className='flex justify-end'>
        <Button size='sm' onClick={() => setCreateOpen(true)}>
          <Icons.add className='mr-1 h-4 w-4' /> 新建条目
        </Button>
      </div>
      <div className='grid gap-2'>
        {data.entities.map((entity) => (
          <div key={entity.id} className='flex items-center gap-3 rounded-lg border p-3'>
            <Badge variant='outline' className='shrink-0'>
              {KIND_LABELS[entity.kind] ?? entity.kind}
            </Badge>
            <div className='min-w-0 flex-1'>
              <Link
                href={`/dashboard/worlds/${worldId}/entities/${entity.uid}`}
                className='font-medium underline-offset-2 hover:underline'
              >
                {entity.name}
              </Link>
              <div className='truncate text-xs text-muted-foreground'>
                {entity.summary || '（无摘要）'}
              </div>
            </div>
            <span className='text-xs text-muted-foreground'>{entity.confidence}</span>
            <Button
              size='sm'
              variant='ghost'
              onClick={() => setPendingDelete(entity)}
              aria-label={`删除 ${entity.name}`}
            >
              <Icons.trash className='h-4 w-4' />
            </Button>
          </div>
        ))}
        {data.entities.length === 0 && (
          <p className='py-8 text-center text-sm text-muted-foreground'>尚无条目。</p>
        )}
      </div>

      <SimpleSheet
        open={createOpen}
        title='新建设定条目（提交为待审变更）'
        onClose={() => setCreateOpen(false)}
        onSubmit={(values) => submit.mutate({ payload: values })}
        pending={submit.isPending}
        fields={{
          name: { label: '名称' },
          kind: { label: '类型', placeholder: 'character / location / organization …' },
          summary: { label: '摘要', textarea: true }
        }}
      />
      <AlertModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.uid);
          setPendingDelete(null);
        }}
        loading={remove.isPending}
        title={`删除「${pendingDelete?.name ?? ''}」`}
        description='将提交一条删除变更，合并后生效；历史版本不受影响。'
      />
    </div>
  );
}

// ------------------------------------------------------------
// Events
// ------------------------------------------------------------

export function EventsTab({ worldId }: { worldId: string }) {
  const eventsQuery = useSuspenseQuery(eventsQueryOptions(worldId));
  const epochsQuery = useSuspenseQuery(epochsQueryOptions(worldId));
  const [createOpen, setCreateOpen] = useState(false);
  const submit = useMutation({
    ...submitEventChangeMutation(worldId),
    onSuccess: () => {
      toast.success('事件已提交审阅');
      setCreateOpen(false);
    },
    onError: (e: Error) => toast.error(e.message)
  });

  return (
    <div className='space-y-3'>
      <div className='flex justify-end'>
        <Button size='sm' onClick={() => setCreateOpen(true)}>
          <Icons.add className='mr-1 h-4 w-4' /> 记录事件
        </Button>
      </div>
      <ol className='relative space-y-3 border-l pl-4'>
        {eventsQuery.data.events.map((event) => {
          const epoch = epochsQuery.data.epochs.find((e) => e.uid === event.epochUid);
          return (
            <li key={event.id} className='relative rounded-lg border p-3'>
              <span className='absolute -left-[21px] top-4 h-2 w-2 rounded-full border-2 border-primary bg-background' />
              <div className='flex items-center gap-2'>
                <span className='font-medium'>{event.title}</span>
                {epoch && <Badge variant='outline'>{epoch.name}</Badge>}
                {event.epochYear !== null && (
                  <span className='text-xs text-muted-foreground'>{event.epochYear} 年</span>
                )}
              </div>
              {event.summary && (
                <p className='mt-1 text-xs text-muted-foreground'>{event.summary}</p>
              )}
            </li>
          );
        })}
        {eventsQuery.data.events.length === 0 && (
          <p className='py-8 text-center text-sm text-muted-foreground'>编年史还是空的。</p>
        )}
      </ol>

      <SimpleSheet
        open={createOpen}
        title='记录编年史事件（提交为待审变更）'
        onClose={() => setCreateOpen(false)}
        onSubmit={(values) =>
          submit.mutate({
            payload: {
              title: values.title,
              summary: values.summary,
              epochUid: values.epochUid || null,
              epochYear: values.epochYear ? Number(values.epochYear) : null
            }
          })
        }
        pending={submit.isPending}
        fields={{
          title: { label: '事件标题' },
          epochUid: { label: '所属纪元 uid（可留空）' },
          epochYear: { label: '纪元内第几年', placeholder: '数字' },
          summary: { label: '摘要', textarea: true }
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------
// Review
// ------------------------------------------------------------

export function ReviewTab({ worldId }: { worldId: string }) {
  const [status, setStatus] = useState<'pending' | 'merged'>('pending');
  const { data } = useSuspenseQuery({
    queryKey: ['changes-detailed', worldId, status],
    queryFn: async () => {
      const response = await fetch(`/api/worlds/${worldId}/changes?detailed=1&status=${status}`);
      if (!response.ok) throw new Error('加载失败');
      return (await response.json()) as {
        changes: {
          id: string;
          kind: string;
          batchId: string | null;
          display: string;
          summary: string;
          author: string;
          payload: unknown;
          candidatePayload: unknown | null;
          conflict: boolean;
          provenance: unknown;
          sourceEvidence: {
            sourceUid: string;
            filename: string;
            start: number;
            end: number;
            excerpt: string;
            truncated: boolean;
            hashMatches: boolean;
            sourceHashMatches: boolean;
          }[];
        }[];
      };
    }
  });
  const merge = useMutation({
    ...mergeWorldMutation(worldId),
    onSuccess: (r) =>
      toast.success(`已合并为 v${r.version}（${r.conflictCount} 冲突，latest-wins）`),
    onError: (e: Error) => toast.error(e.message)
  });
  const discard = useMutation({
    ...deleteChangeMutation(worldId),
    onSuccess: () => toast.success('已弃用'),
    onError: (e: Error) => toast.error(e.message)
  });

  // 按批次分组（一次编译 = 一组）
  const groups = new Map<string, typeof data.changes>();
  for (const change of data.changes) {
    const key = change.batchId ?? 'single';
    groups.set(key, [...(groups.get(key) ?? []), change]);
  }
  const KIND_LABEL: Record<string, string> = {
    entity_upsert: '条目',
    entity_delete: '删条目',
    event_upsert: '事件',
    event_delete: '删事件',
    epoch_upsert: '纪元',
    epoch_delete: '删纪元',
    relation_upsert: '关系',
    relation_delete: '删关系'
  };

  return (
    <div className='space-y-3'>
      <div className='flex items-center gap-2'>
        <Button
          size='sm'
          variant={status === 'pending' ? 'default' : 'outline'}
          onClick={() => setStatus('pending')}
        >
          待审批
        </Button>
        <Button
          size='sm'
          variant={status === 'merged' ? 'default' : 'outline'}
          onClick={() => setStatus('merged')}
        >
          历史审批
        </Button>
        <span className='text-xs text-muted-foreground'>
          {data.changes.length} 条变更 · {groups.size} 个批次
        </span>
        {status === 'pending' && (
          <Button
            size='sm'
            className='ml-auto'
            disabled={data.changes.length === 0 || merge.isPending}
            onClick={() => merge.mutate(`合并 ${data.changes.length} 项变更`)}
          >
            <Icons.check className='mr-1 h-4 w-4' /> 合并全部（{data.changes.length}）
          </Button>
        )}
      </div>
      <div className='space-y-2'>
        {[...groups.entries()].map(([batchId, items]) => (
          <details key={batchId} className='rounded-lg border p-3' open={items.length <= 8}>
            <summary className='cursor-pointer text-sm'>
              <span className='font-medium'>
                {batchId === 'single' ? '手工提交' : `编译批次 ${batchId.slice(-6)}`}
              </span>
              <span className='ml-2 text-xs text-muted-foreground'>
                {items.length} 条（{items.filter((i) => i.kind === 'entity_upsert').length} 条目 ·{' '}
                {items.filter((i) => i.kind === 'event_upsert').length} 事件 ·{' '}
                {items.filter((i) => i.kind === 'relation_upsert').length} 关系）· 来源{' '}
                {items[0].author}
              </span>
            </summary>
            <div className='mt-2 space-y-1'>
              {items.map((change) => {
                const diffRows = reviewDiffRows(change.candidatePayload, change.payload);
                return (
                  <details key={change.id} className='rounded-md border border-dashed p-2'>
                    <summary className='flex cursor-pointer items-center gap-2 text-xs'>
                      <Badge variant='outline' className='shrink-0'>
                        {KIND_LABEL[change.kind] ?? change.kind}
                      </Badge>
                      <span className='min-w-0 flex-1 truncate'>{change.display}</span>
                      {change.conflict && (
                        <Badge variant='destructive' className='text-[10px]'>
                          冲突
                        </Badge>
                      )}
                      {status === 'pending' && (
                        <Button
                          size='sm'
                          variant='ghost'
                          aria-label='弃用'
                          onClick={(event) => {
                            event.preventDefault();
                            discard.mutate(change.id);
                          }}
                        >
                          <Icons.close className='h-3.5 w-3.5' />
                        </Button>
                      )}
                    </summary>
                    <div className='mt-2 grid gap-2 text-xs md:grid-cols-4'>
                      {change.sourceEvidence.length > 0 && (
                        <div>
                          <p className='mb-1 font-medium text-muted-foreground'>原文证据</p>
                          <div className='space-y-2'>
                            {change.sourceEvidence.map((evidence) => (
                              <div
                                key={`${evidence.sourceUid}:${evidence.start}:${evidence.end}`}
                                className='rounded bg-muted p-2'
                              >
                                <p className='mb-1 text-[11px] text-muted-foreground'>
                                  {evidence.filename} · {evidence.start}–{evidence.end}
                                  {evidence.hashMatches && evidence.sourceHashMatches
                                    ? ' · hash 已校验'
                                    : ' · hash 不匹配'}
                                </p>
                                <pre className='max-h-48 overflow-auto whitespace-pre-wrap'>
                                  {evidence.excerpt}
                                  {evidence.truncated ? '\n…（证据已截断）' : ''}
                                </pre>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <p className='mb-1 font-medium text-muted-foreground'>编译候选 payload</p>
                        <pre className='max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2'>
                          {formatReviewJson(change.candidatePayload ?? change.payload)}
                        </pre>
                      </div>
                      <div>
                        <p className='mb-1 flex items-center gap-1 font-medium text-muted-foreground'>
                          当前 Change payload
                          {change.candidatePayload !== null &&
                            formatReviewJson(change.candidatePayload) !==
                              formatReviewJson(change.payload) && (
                              <Badge variant='secondary' className='text-[10px]'>
                                已编辑
                              </Badge>
                            )}
                        </p>
                        <pre className='max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2'>
                          {formatReviewJson(change.payload)}
                        </pre>
                      </div>
                      <div>
                        <p className='mb-1 font-medium text-muted-foreground'>来源 provenance</p>
                        <pre className='max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2'>
                          {formatReviewJson(change.provenance)}
                        </pre>
                      </div>
                    </div>
                    {change.candidatePayload !== null && (
                      <div className='mt-2 rounded bg-muted/50 p-2'>
                        <p className='mb-1 flex items-center gap-2 font-medium text-muted-foreground'>
                          结构化差异
                          <Badge variant={diffRows.length > 0 ? 'secondary' : 'outline'}>
                            {diffRows.length > 0 ? `${diffRows.length} 处字段变化` : '未修改'}
                          </Badge>
                        </p>
                        {diffRows.length > 0 ? (
                          <div className='overflow-auto rounded border'>
                            <table className='w-full min-w-[720px] text-[11px]'>
                              <thead className='bg-muted text-left'>
                                <tr>
                                  <th className='px-2 py-1 font-medium'>字段路径</th>
                                  <th className='px-2 py-1 font-medium'>编译候选</th>
                                  <th className='px-2 py-1 font-medium'>当前 Change</th>
                                </tr>
                              </thead>
                              <tbody>
                                {diffRows.map((row) => (
                                  <tr key={row.path} className='border-t align-top'>
                                    <td className='whitespace-nowrap px-2 py-1 font-mono text-muted-foreground'>
                                      {row.path}
                                    </td>
                                    <td className='max-w-[360px] whitespace-pre-wrap px-2 py-1 text-red-700 dark:text-red-300'>
                                      {formatReviewJson(row.candidate)}
                                    </td>
                                    <td className='max-w-[360px] whitespace-pre-wrap px-2 py-1 text-green-700 dark:text-green-300'>
                                      {formatReviewJson(row.current)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className='text-xs text-muted-foreground'>当前 Change 尚未编辑。</p>
                        )}
                      </div>
                    )}
                  </details>
                );
              })}
            </div>
          </details>
        ))}
        {data.changes.length === 0 && (
          <p className='py-8 text-center text-sm text-muted-foreground'>
            没有{status === 'pending' ? '待审' : '历史'}变更。
          </p>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Versions
// ------------------------------------------------------------

export function VersionsTab({ worldId }: { worldId: string }) {
  const { data } = useSuspenseQuery(versionsQueryOptions(worldId));
  const rollback = useMutation({
    ...rollbackVersionMutation(worldId),
    onSuccess: (r) => toast.success(`已回滚，主版本现为 v${r.version}`),
    onError: (e: Error) => toast.error(e.message)
  });

  return (
    <div className='space-y-2'>
      {data.versions.map((version) => (
        <div key={version.id} className='flex items-center gap-3 rounded-lg border p-3 text-sm'>
          <Badge variant='secondary'>v{version.version}</Badge>
          <span className='min-w-0 flex-1 truncate'>{version.summary}</span>
          {version.conflictCount > 0 && (
            <Badge variant='destructive'>{version.conflictCount} 冲突</Badge>
          )}
          {rollback.isPending && <Icons.spinner className='h-4 w-4 animate-spin' />}
          <Button
            size='sm'
            variant='outline'
            disabled={rollback.isPending}
            onClick={() => rollback.mutate(version.version)}
          >
            回滚到此版本
          </Button>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------
// Minimal generic dialog form (Phase 1; TanStack Form polish comes later)
// ------------------------------------------------------------

type FieldSpec = { label: string; textarea?: boolean; placeholder?: string };
type FieldValues = Record<string, string>;

function SimpleSheet({
  open,
  title,
  fields,
  onClose,
  onSubmit,
  pending
}: {
  open: boolean;
  title: string;
  fields: Record<string, FieldSpec>;
  onClose: () => void;
  onSubmit: (values: FieldValues) => void;
  pending: boolean;
}) {
  const [values, setValues] = useState<FieldValues>({});

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className='max-h-[85vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className='space-y-4'>
          {Object.entries(fields).map(([key, spec]) => (
            <div key={key} className='space-y-2'>
              <Label htmlFor={`sheet-${key}`}>{spec.label}</Label>
              {spec.textarea ? (
                <Textarea
                  id={`sheet-${key}`}
                  value={values[key] ?? ''}
                  placeholder={spec.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                />
              ) : (
                <Input
                  id={`sheet-${key}`}
                  value={values[key] ?? ''}
                  placeholder={spec.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>
        <div className='flex justify-end gap-2'>
          <Button variant='outline' onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              onSubmit(values);
              setValues({});
            }}
          >
            {pending ? '提交中…' : '提交审阅'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SourcesTab({ worldId }: { worldId: string }) {
  const { data } = useSuspenseQuery(sourcesQueryOptions(worldId));
  const queryClient = useQueryClient();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [compileRunId, setCompileRunId] = useState<string | null>(null);
  const compileRun = useQuery({
    queryKey: ['compile-run', worldId, compileRunId],
    queryFn: () => fetchCompileRun(worldId, compileRunId as string),
    enabled: Boolean(compileRunId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status && ['completed', 'failed', 'cancelled'].includes(status) ? false : 1_000;
    }
  });
  useEffect(() => {
    const status = compileRun.data?.run.status;
    if (!status || !['completed', 'failed', 'cancelled'].includes(status)) return;
    if (status === 'completed') {
      toast.success(`编译完成：${compileRun.data?.run.result && '变更已进入审阅队列'}`);
      void queryClient.invalidateQueries({ queryKey: worldKeys.sources(worldId) });
      void queryClient.invalidateQueries({ queryKey: worldKeys.changes(worldId) });
    } else if (status === 'failed') {
      toast.error(`编译失败：${compileRun.data?.run.error ?? '未知错误'}`);
    }
  }, [compileRun.data?.run, queryClient, worldId]);
  const create = useMutation({
    ...createSourceMutation(worldId),
    onSuccess: () => {
      toast.success('素材已入库');
      setPasteOpen(false);
    },
    onError: (e: Error) => toast.error(e.message)
  });
  const compile = useMutation({
    ...compileSourceMutation(worldId),
    onSuccess: (r) => {
      setCompileRunId(r.runId);
      toast.success(`已提交编译任务：${r.totalChunks} 个分块，可在后台持续运行`);
    },
    onError: (e: Error) => toast.error(e.message)
  });
  const [filename, setFilename] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');

  return (
    <div className='space-y-3'>
      <div className='flex justify-end'>
        <Button size='sm' onClick={() => setPasteOpen(true)}>
          <Icons.add className='mr-1 h-4 w-4' /> 粘贴素材
        </Button>
      </div>
      <div className='space-y-2'>
        {data.sources.map((source) => (
          <div key={source.id} className='flex items-center gap-3 rounded-lg border p-3 text-sm'>
            <Badge variant={source.status === 'compiled' ? 'secondary' : 'outline'}>
              {source.status}
            </Badge>
            <span className='min-w-0 flex-1 truncate font-medium'>{source.filename}</span>
            <span className='text-xs text-muted-foreground'>
              {Math.round(source.sizeBytes / 100) / 10} kB
            </span>
            <Button
              size='sm'
              variant='outline'
              disabled={
                compile.isPending ||
                (Boolean(compileRunId) &&
                  !['completed', 'failed', 'cancelled'].includes(compileRun.data?.run.status ?? ''))
              }
              onClick={() => compile.mutate(source.id)}
            >
              {compile.isPending ? (
                <Icons.spinner className='h-4 w-4 animate-spin' />
              ) : (
                <Icons.sparkles className='h-4 w-4' />
              )}
              编译
            </Button>
          </div>
        ))}
        {data.sources.length === 0 && (
          <p className='py-8 text-center text-sm text-muted-foreground'>
            尚无素材。粘贴一段设定稿或正文，LLM 会把它编译成条目与编年史事件（走审阅链）。
          </p>
        )}
        {compileRun.data?.run && compileRunId && (
          <div className='rounded-lg border border-dashed p-3 text-xs text-muted-foreground'>
            编译任务：{compileRun.data.run.completedChunks}/{compileRun.data.run.totalChunks} 个分块
            · {compileRun.data.run.status}
            <div className='mt-1 flex flex-wrap gap-x-3 gap-y-1'>
              <span>
                用量：
                {compileRun.data.run.usage.totalTokens === null
                  ? '未返回'
                  : `${compileRun.data.run.usage.totalTokens.toLocaleString()} tokens`}
              </span>
              <span>
                延迟：
                {compileRun.data.run.usage.latencyMs === null
                  ? '未记录'
                  : `${Math.round(compileRun.data.run.usage.latencyMs).toLocaleString()} ms`}
              </span>
              <span>
                成本：
                {compileRun.data.run.usage.pricingConfigured
                  ? `${compileRun.data.run.usage.estimatedCostUsd ?? 0} USD`
                  : '未配置价格表'}
              </span>
              <span>用量完整度：{Math.round(compileRun.data.run.usage.usageCoverage * 100)}%</span>
              {compileRun.data.run.usage.limits && (
                <span>
                  预算上限：
                  {compileRun.data.run.usage.limits.maxEstimatedCostUsdPerRun === null
                    ? '未配置金额'
                    : `${compileRun.data.run.usage.limits.maxEstimatedCostUsdPerRun} USD`}
                </span>
              )}
            </div>
            <div className='mt-2 space-y-1 border-t pt-2'>
              {compileRun.data.run.chunks.map((chunk) => (
                <div
                  key={chunk.index}
                  className='flex flex-wrap items-center gap-x-2 gap-y-1 rounded border px-2 py-1'
                >
                  <span className='font-medium'>分块 {chunk.index + 1}</span>
                  <Badge variant={chunk.status === 'failed' ? 'destructive' : 'outline'}>
                    {COMPILE_CHUNK_STATUS_LABELS[chunk.status] ?? chunk.status}
                  </Badge>
                  <span>
                    原文 {chunk.sourceStart}–{chunk.sourceEnd} · 尝试 {chunk.attempts} 次
                  </span>
                  {chunk.error && <span className='text-destructive'>{chunk.error}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Dialog open={pasteOpen} onOpenChange={(next) => (next ? undefined : setPasteOpen(false))}>
        <DialogContent className='max-h-[85vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>粘贴素材</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='src-name'>文件名</Label>
              <Input
                id='src-name'
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder='第 1 章 · 枯井.md'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='src-content'>内容</Label>
              <Textarea
                id='src-content'
                rows={8}
                className='max-h-[35vh] overflow-y-auto'
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
          </div>
          <div className='flex justify-end gap-2'>
            <Button variant='outline' onClick={() => setPasteOpen(false)}>
              取消
            </Button>
            <Button
              disabled={(!content.trim() && !url.trim()) || create.isPending}
              onClick={() => {
                create.mutate(
                  url.trim()
                    ? { filename: filename || undefined, url: url.trim(), content: '' }
                    : { filename: filename || undefined, content }
                );
                setContent('');
                setFilename('');
                setUrl('');
              }}
            >
              {create.isPending ? '入库中…' : '入库'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ------------------------------------------------------------
// Genesis wizard (创世向导)
// ------------------------------------------------------------

export function GenesisTab({
  worldId,
  premise,
  style
}: {
  worldId: string;
  premise: string;
  style: string;
}) {
  const [premiseInput, setPremiseInput] = useState(premise);
  const [styleInput, setStyleInput] = useState(style);
  const [plan, setPlan] = useState<GenesisPlan | null>(null);
  const planMut = useMutation({
    ...planGenesisMutation(worldId),
    onSuccess: (r) => {
      setPlan(r.plan);
      toast.success('框架已生成，请审阅后采纳');
    },
    onError: (e: Error) => toast.error(e.message)
  });
  const commitMut = useMutation({
    ...commitGenesisMutation(worldId),
    onSuccess: (r) => {
      toast.success(`创世完成：${r.staged} 条变更已进入审阅队列（${r.defects.length} 缺陷）`);
      setPlan(null);
    },
    onError: (e: Error) => toast.error(e.message)
  });

  return (
    <div className='space-y-4'>
      <p className='max-w-3xl text-sm text-muted-foreground'>
        两步创世：① 由一句话前提生成世界框架（纪元/势力/地域/叙事线预览，不入库）；② 审阅后采纳 →
        LLM 批量生成条目与编年史骨架，全部进入审阅队列，逐条把关。
      </p>
      <div className='grid gap-3 md:grid-cols-2'>
        <div className='space-y-2'>
          <Label htmlFor='gen-premise'>一句话前提</Label>
          <Textarea
            id='gen-premise'
            rows={3}
            value={premiseInput}
            onChange={(e) => setPremiseInput(e.target.value)}
            placeholder='例：一个修行者以梦为舟、渡人间执念的世界。'
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='gen-style'>风格基调（可选）</Label>
          <Textarea
            id='gen-style'
            rows={3}
            value={styleInput}
            onChange={(e) => setStyleInput(e.target.value)}
            placeholder='例：东方仙侠、苍凉厚重、群像叙事。'
          />
        </div>
      </div>
      <div className='flex gap-2'>
        <Button
          disabled={!premiseInput.trim() || planMut.isPending}
          onClick={() => planMut.mutate({ premise: premiseInput, style: styleInput })}
        >
          {planMut.isPending ? '规划中…' : '① 生成世界框架'}
        </Button>
        {plan && (
          <Button
            variant='secondary'
            disabled={commitMut.isPending}
            onClick={() => commitMut.mutate({ premise: premiseInput, style: styleInput, plan })}
          >
            {commitMut.isPending ? '生成中…' : '② 采纳框架并生成世界'}
          </Button>
        )}
      </div>

      {plan && (
        <div className='space-y-3 rounded-lg border p-4'>
          {plan.premiseExpanded && <p className='text-sm'>{plan.premiseExpanded}</p>}
          {plan.tone && <p className='text-xs text-muted-foreground'>基调：{plan.tone}</p>}
          <div className='grid gap-3 md:grid-cols-3'>
            <div>
              <p className='mb-1 text-xs font-semibold text-muted-foreground'>
                纪元（{plan.epochs.length}）
              </p>
              <ul className='space-y-1 text-xs'>
                {plan.epochs.map((e) => (
                  <li key={e.name}>
                    · {e.name}：{e.description}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className='mb-1 text-xs font-semibold text-muted-foreground'>
                势力（{plan.factions.length}）
              </p>
              <ul className='space-y-1 text-xs'>
                {plan.factions.map((f) => (
                  <li key={f.name}>
                    · {f.name}：{f.summary}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className='mb-1 text-xs font-semibold text-muted-foreground'>
                地域（{plan.regions.length}）
              </p>
              <ul className='space-y-1 text-xs'>
                {plan.regions.map((r) => (
                  <li key={r.name}>
                    · {r.name}：{r.summary}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {plan.threads.length > 0 && (
            <div className='text-xs text-muted-foreground'>叙事线：{plan.threads.join('；')}</div>
          )}
        </div>
      )}
    </div>
  );
}
