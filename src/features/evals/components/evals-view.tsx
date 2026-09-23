'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Icons } from '@/components/icons';
import { toast } from 'sonner';

type World = { id: string; name: string };
type EvalKind = 'retrieval' | 'answer';
type EvalCase = {
  id: string;
  kind: EvalKind;
  query: string;
  expectedUid: string;
  rubric: string;
  note: string;
};
type AnswerRow = {
  query: string;
  answer?: string;
  citationCount?: number;
  score: number | null;
  reason: string;
  skipped?: boolean;
};
type EvalRun = {
  id: string;
  version: number;
  mode: 'lexical' | 'hybrid' | 'answer';
  score: number;
  createdAt: string;
  results:
    | AnswerRow[]
    | { query: string; expectedUid: string; hit: boolean; rank: number | null }[];
};

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const options: RequestInit = { method };
  if (body !== undefined) {
    options.headers = { 'content-type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message ?? `请求失败：${response.status}`);
  return payload as T;
}

const scoreBadgeVariant = (score: number | null) =>
  score === null
    ? 'outline'
    : score >= 0.8
      ? 'secondary'
      : score >= 0.5
        ? 'default'
        : 'destructive';

export function EvalsView() {
  const queryClient = useQueryClient();
  const [worldId, setWorldId] = useState('');
  const worlds = useQuery({
    queryKey: ['worlds'],
    queryFn: () => api<{ worlds: World[] }>('/api/worlds')
  });
  const effectiveWorld = worldId || worlds.data?.worlds[0]?.id || '';

  const targets = useQuery({
    queryKey: ['eval-targets', effectiveWorld],
    queryFn: async () => {
      const [entities, events] = await Promise.all([
        api<{ entities: { uid: string; name: string }[] }>(
          `/api/worlds/${effectiveWorld}/entities`
        ),
        api<{ events: { uid: string; title: string }[] }>(`/api/worlds/${effectiveWorld}/events`)
      ]);
      return [
        ...entities.entities.map((e) => ({ uid: e.uid, name: `条目 · ${e.name}` })),
        ...events.events.map((e) => ({ uid: e.uid, name: `事件 · ${e.title}` }))
      ];
    },
    enabled: Boolean(effectiveWorld)
  });

  const evalData = useQuery({
    queryKey: ['evals', effectiveWorld],
    queryFn: () =>
      api<{ runs: EvalRun[]; cases: EvalCase[] }>(`/api/worlds/${effectiveWorld}/evals`),
    enabled: Boolean(effectiveWorld)
  });

  const cases = evalData.data?.cases ?? [];
  const retrievalCases = cases.filter((c) => c.kind !== 'answer');
  const answerCases = cases.filter((c) => c.kind === 'answer');
  const runs = evalData.data?.runs ?? [];
  const answerRuns = runs.filter((r) => r.mode === 'answer');
  const retrievalRuns = runs.filter((r) => r.mode !== 'answer');
  const latestAnswer = answerRuns[0];
  // 榜单：按得分降序
  const leaderboard = [...answerRuns].toSorted((a, b) => b.score - a.score);

  const [form, setForm] = useState<{
    kind: EvalKind;
    query: string;
    expectedUid: string;
    rubric: string;
  }>({
    kind: 'retrieval',
    query: '',
    expectedUid: '',
    rubric: ''
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['evals', effectiveWorld] });

  const addCase = useMutation({
    mutationFn: () =>
      api(
        `/api/worlds/${effectiveWorld}/evals/cases`,
        'POST',
        form.kind === 'answer'
          ? { kind: 'answer', query: form.query, rubric: form.rubric }
          : { kind: 'retrieval', query: form.query, expectedUid: form.expectedUid }
      ),
    onSuccess: () => {
      toast.success('评测用例已添加');
      setForm({ kind: form.kind, query: '', expectedUid: '', rubric: '' });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const runRetrieval = useMutation({
    mutationFn: () =>
      api<{ score: number }>(`/api/worlds/${effectiveWorld}/evals`, 'POST', {
        cases: retrievalCases.map((c) => ({
          query: c.query,
          expectedUid: c.expectedUid,
          note: c.note
        }))
      }),
    onSuccess: (r) => {
      toast.success(`检索跑分完成：命中率 ${(r.score * 100).toFixed(0)}%`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const runAnswer = useMutation({
    mutationFn: () =>
      api<{ score: number }>(`/api/worlds/${effectiveWorld}/evals`, 'POST', {
        mode: 'answer',
        cases: answerCases.map((c) => ({ query: c.query, rubric: c.rubric || undefined }))
      }),
    onSuccess: (r) => {
      toast.success(`答案评测完成：均分 ${(r.score * 100).toFixed(0)}`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const latestRetrieval = retrievalRuns[0];

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <Label htmlFor='eval-world'>世界</Label>
        <select
          id='eval-world'
          className='rounded-md border bg-background px-2 py-1 text-sm'
          value={effectiveWorld}
          onChange={(e) => setWorldId(e.target.value)}
        >
          {worlds.data?.worlds.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <span className='text-xs text-muted-foreground'>
          检索评测 = 查询 + 期望命中（top-10 命中率）· 答案评测 = 问题 + 评分要点（LLM 裁判 0~100）
        </span>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Button
          size='sm'
          disabled={!retrievalCases.length || runRetrieval.isPending}
          onClick={() => runRetrieval.mutate()}
        >
          {runRetrieval.isPending ? (
            <Icons.spinner className='mr-1 h-4 w-4 animate-spin' />
          ) : (
            <Icons.check className='mr-1 h-4 w-4' />
          )}
          运行检索评测（{retrievalCases.length} 例）
        </Button>
        <Button
          size='sm'
          variant='outline'
          disabled={!answerCases.length || runAnswer.isPending}
          onClick={() => runAnswer.mutate()}
        >
          {runAnswer.isPending ? (
            <Icons.spinner className='mr-1 h-4 w-4 animate-spin' />
          ) : (
            <Icons.check className='mr-1 h-4 w-4' />
          )}
          运行答案评测（{answerCases.length} 例）
        </Button>
      </div>

      <div className='space-y-2 rounded-lg border p-4'>
        <div className='flex items-center gap-2'>
          <p className='text-sm font-semibold'>评测集（{cases.length} 例）</p>
          <div className='ml-auto flex items-center gap-3 text-xs'>
            <label className='flex items-center gap-1'>
              <input
                type='radio'
                name='case-kind'
                checked={form.kind === 'retrieval'}
                onChange={() => setForm({ ...form, kind: 'retrieval' })}
              />
              检索命中
            </label>
            <label className='flex items-center gap-1'>
              <input
                type='radio'
                name='case-kind'
                checked={form.kind === 'answer'}
                onChange={() => setForm({ ...form, kind: 'answer' })}
              />
              答案质量
            </label>
          </div>
        </div>
        <div className='flex flex-wrap items-end gap-2'>
          <div className='min-w-[240px] flex-1 space-y-1'>
            <Label htmlFor='case-query'>{form.kind === 'answer' ? '问题' : '查询'}</Label>
            <Input
              id='case-query'
              value={form.query}
              onChange={(e) => setForm({ ...form, query: e.target.value })}
              placeholder='向顶天的师父是谁'
            />
          </div>
          {form.kind === 'retrieval' ? (
            <div className='min-w-[240px] flex-1 space-y-1'>
              <Label htmlFor='case-target'>期望命中</Label>
              <select
                id='case-target'
                className='w-full rounded-md border bg-background px-2 py-2 text-sm'
                value={form.expectedUid}
                onChange={(e) => setForm({ ...form, expectedUid: e.target.value })}
              >
                <option value=''>选择条目 / 事件</option>
                {targets.data?.map((t) => (
                  <option key={t.uid} value={t.uid}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className='min-w-[240px] flex-1 space-y-1'>
              <Label htmlFor='case-rubric'>评分要点</Label>
              <Input
                id='case-rubric'
                value={form.rubric}
                onChange={(e) => setForm({ ...form, rubric: e.target.value })}
                placeholder='必须指出云隐子是师父；需引用来源'
              />
            </div>
          )}
          <Button
            size='sm'
            disabled={
              !form.query.trim() ||
              addCase.isPending ||
              (form.kind === 'retrieval' && !form.expectedUid)
            }
            onClick={() => addCase.mutate()}
          >
            添加用例
          </Button>
        </div>
        <div className='space-y-1'>
          {cases.map((c) => (
            <div key={c.id} className='flex items-center gap-2 text-xs text-muted-foreground'>
              <Badge variant='outline' className='text-[10px]'>
                {c.kind === 'answer' ? '答案' : '检索'}
              </Badge>
              <span className='truncate'>{c.query}</span>
              <span className='ml-auto shrink-0'>
                {c.kind === 'answer'
                  ? c.rubric || '（无评分要点）'
                  : (targets.data?.find((t) => t.uid === c.expectedUid)?.name ?? c.expectedUid)}
              </span>
            </div>
          ))}
          {cases.length === 0 && (
            <p className='py-4 text-center text-xs text-muted-foreground'>
              还没有评测用例。添加后点「运行检索评测」或「运行答案评测」。
            </p>
          )}
        </div>
      </div>

      {latestAnswer && (
        <div className='space-y-2 rounded-lg border p-4'>
          <div className='flex items-center gap-3'>
            <span className='text-sm font-semibold'>最近答案评测（v{latestAnswer.version}）</span>
            <Badge variant={scoreBadgeVariant(latestAnswer.score)}>
              均分 {(latestAnswer.score * 100).toFixed(0)}
            </Badge>
            <span className='text-xs text-muted-foreground'>
              {new Date(latestAnswer.createdAt).toLocaleString('zh-CN')}
            </span>
          </div>
          <div className='space-y-1'>
            {(latestAnswer.results as AnswerRow[]).map((r, i) => (
              <div key={i} className='flex items-center gap-2 text-xs'>
                <Badge variant={scoreBadgeVariant(r.score)}>
                  {r.skipped
                    ? '跳过'
                    : r.score === null
                      ? '未评分'
                      : `${(r.score * 100).toFixed(0)} 分`}
                </Badge>
                <span className='truncate'>{r.query}</span>
                <span className='truncate text-muted-foreground'>{r.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {answerRuns.length > 1 && (
        <div className='space-y-2 rounded-lg border p-4'>
          <p className='text-sm font-semibold'>答案评测榜单（按均分）</p>
          {leaderboard.map((r, index) => (
            <div key={r.id} className='flex items-center gap-2 text-xs'>
              <Badge variant={index === 0 ? 'default' : 'outline'}>#{index + 1}</Badge>
              <Badge variant='outline'>v{r.version}</Badge>
              <span>均分 {(r.score * 100).toFixed(0)}</span>
              <span className='text-muted-foreground'>{r.results.length} 例</span>
              <span className='ml-auto'>{new Date(r.createdAt).toLocaleString('zh-CN')}</span>
            </div>
          ))}
        </div>
      )}

      {latestRetrieval && (
        <div className='space-y-2 rounded-lg border p-4'>
          <div className='flex items-center gap-3'>
            <span className='text-sm font-semibold'>
              最近检索评测（v{latestRetrieval.version} · {latestRetrieval.mode}）
            </span>
            <Badge
              variant={
                latestRetrieval.score >= 0.8
                  ? 'secondary'
                  : latestRetrieval.score >= 0.5
                    ? 'default'
                    : 'destructive'
              }
            >
              命中率 {(latestRetrieval.score * 100).toFixed(0)}%
            </Badge>
            <span className='text-xs text-muted-foreground'>
              {new Date(latestRetrieval.createdAt).toLocaleString('zh-CN')}
            </span>
          </div>
          <div className='space-y-1'>
            {(
              latestRetrieval.results as { query: string; hit: boolean; rank: number | null }[]
            ).map((r, i) => (
              <div key={i} className='flex items-center gap-2 text-xs'>
                <Badge variant={r.hit ? 'secondary' : 'destructive'}>
                  {r.hit ? `命中 #${r.rank}` : '未命中'}
                </Badge>
                <span className='truncate'>{r.query}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {retrievalRuns.length > 1 && (
        <div className='space-y-1 rounded-lg border p-4'>
          <p className='text-sm font-semibold'>检索评测历史</p>
          {retrievalRuns.slice(1).map((r) => (
            <div key={r.id} className='flex items-center gap-2 text-xs text-muted-foreground'>
              <Badge variant='outline'>v{r.version}</Badge>
              <span>命中率 {(r.score * 100).toFixed(0)}%</span>
              <span className='ml-auto'>{new Date(r.createdAt).toLocaleString('zh-CN')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
