'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { splitChapters } from '@/lib/chapter-split';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Icons } from '@/components/icons';
import { toast } from 'sonner';

/**
 * 作品创作台 (Phase 5 core loop):
 * 章节管理 → 定稿回编译 → 光标推进；推演候选生成 → 采纳入审阅链 / 忽略。
 */

async function api<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (payload?.error?.details ?? [])[0];
    const extra = detail ? `（${detail.path?.join('.') ?? ''}：${detail.message ?? ''}）` : '';
    throw new Error(`${payload?.error?.message ?? `请求失败：${response.status}`}${extra}`);
  }
  return payload as T;
}

interface ChapterRow {
  id: string;
  order: number;
  title: string;
  content: string;
  status: string;
}
interface ManuscriptRow {
  id: string;
  title: string;
  synopsis: string;
  cursorEventUid: string | null;
  chapters: ChapterRow[];
  pendingContinuations: number;
  cursor: { uid: string; title: string; epochYear: number | null } | null;
}
interface ContinuationRow {
  id: string;
  kind: string;
  payload: {
    title?: string;
    summary?: string;
    epochName?: string | null;
    year?: number | null;
    relation?: { subject: string; object: string; relation: string; polarity: string } | null;
  };
  rationale: string;
  status: string;
}

const KIND_LABELS: Record<string, string> = {
  event_suggestion: '事件建议',
  relation_shift: '关系变化',
  plot_arc: '情节走向'
};

export function ManuscriptTab({ worldId }: { worldId: string }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const manuscripts = useQuery({
    queryKey: ['manuscripts', worldId],
    queryFn: () =>
      api<{ manuscripts: ManuscriptRow[] }>(`/api/worlds/${worldId}/manuscripts`, 'GET')
  });
  const detail = useQuery({
    queryKey: ['manuscript', worldId, selectedId],
    queryFn: () =>
      api<{ manuscript: ManuscriptRow }>(`/api/worlds/${worldId}/manuscripts/${selectedId}`, 'GET'),
    enabled: Boolean(selectedId)
  });
  const continuations = useQuery({
    queryKey: ['continuations', worldId],
    queryFn: () =>
      api<{ continuations: ContinuationRow[] }>(
        `/api/worlds/${worldId}/continuations?status=pending`,
        'GET'
      )
  });

  const removeManuscript = useMutation({
    mutationFn: (id: string) => api(`/api/worlds/${worldId}/manuscripts/${id}`, 'DELETE'),
    onSuccess: () => {
      toast.success('作品已删除');
      setSelectedId(null);
      refresh();
    },
    onError: (error: Error) => {
      setFinalizingId(null);
      toast.error(error.message);
    }
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['manuscripts', worldId] });
    void queryClient.invalidateQueries({ queryKey: ['manuscript', worldId, selectedId] });
    void queryClient.invalidateQueries({ queryKey: ['continuations', worldId] });
    void queryClient.invalidateQueries({ queryKey: ['world', worldId] });
  };

  const create = useMutation({
    mutationFn: async (input: { title: string; synopsis: string; bulk: string }) => {
      // ===== 第一步：前端切片 =====
      // 每片最多 20000 字，优先在句号处切
      const MAX_CHUNK = 20_000;
      const chunks: { title?: string; content: string }[] = [];
      const rawBlocks = splitChapters(input.bulk);

      for (const block of rawBlocks) {
        const trimmed = block.trim();
        if (!trimmed) continue;
        const lines = trimmed.split('\n');
        const firstLine = lines[0]?.trim() ?? '';
        const title = firstLine.startsWith('第') ? firstLine.slice(0, 60) : undefined;
        const content = title ? lines.slice(1).join('\n').trim() : trimmed;

        if (content.length <= MAX_CHUNK) {
          // 整章一片（优先保证章节完整）
          chunks.push({ title, content });
        } else {
          // >2 万字 → 每 2 万字前找最后一个句号切
          let offset = 0;
          let partNum = 1;
          while (offset < content.length) {
            const slice = content.slice(offset, offset + MAX_CHUNK);
            // 在切片内找最后一个句末标点
            const lastPeriod = Math.max(
              slice.lastIndexOf('。'),
              slice.lastIndexOf('！'),
              slice.lastIndexOf('？'),
              slice.lastIndexOf('\n')
            );
            const actualCut = lastPeriod > MAX_CHUNK / 2 ? lastPeriod + 1 : slice.length;
            const piece = content.slice(offset, offset + actualCut);
            chunks.push({ content: piece });
            offset += actualCut;
            partNum++;
          }
        }
      }

      if (chunks.length === 0) {
        throw new Error('没有可导入的内容');
      }

      // ===== 第二步：分批提交 =====
      // 每批 ≤5 片 且 ≤10 万字符
      const batches: (typeof chunks)[] = [];
      let current: typeof chunks = [];
      let currentChars = 0;
      for (const chunk of chunks) {
        const chunkLen = chunk.content.length;
        if (current.length >= 5 || currentChars + chunkLen > 100_000) {
          if (current.length) batches.push(current);
          current = [];
          currentChars = 0;
        }
        current.push(chunk);
        currentChars += chunkLen;
      }
      if (current.length) batches.push(current);

      // ===== 第三步：提交 =====
      // 第一批创建作品，后续批次追加
      const firstBatch = batches[0];
      const createRes = await api<{ manuscript: ManuscriptRow }>(
        `/api/worlds/${worldId}/manuscripts`,
        'POST',
        { title: input.title, synopsis: input.synopsis, chapters: firstBatch }
      );
      const manuscriptId = createRes.manuscript.id;

      // 后续批次通过 batch 端点追加
      for (let bi = 1; bi < batches.length; bi++) {
        await api(`/api/worlds/${worldId}/manuscripts/${manuscriptId}/chapters/batch`, 'POST', {
          chapters: batches[bi]
        });
      }

      return createRes;
    },
    onSuccess: (result) => {
      toast.success('作品已创建（章节为草稿态）');
      setCreateOpen(false);
      setSelectedId(result.manuscript.id);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message)
  });

  const finalize = useMutation({
    mutationFn: ({ chapterId }: { chapterId: string }) => {
      setFinalizingId(chapterId);
      return api<{ runId: string; totalChunks: number }>(
        `/api/worlds/${worldId}/manuscripts/${selectedId}/chapters/${chapterId}/finalize`,
        'POST'
      );
    },
    onSuccess: (result) => {
      setFinalizingId(null);
      toast.success(`已提交定稿编译任务：${result.totalChunks} 个分块，完成后进入审阅队列`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message)
  });

  const [editing, setEditing] = useState<{ id: string; title: string; content: string } | null>(
    null
  );
  const [finalizingId, setFinalizingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{
    id: string;
    title: string;
    content: string;
    status: string;
  } | null>(null);
  const saveChapter = useMutation({
    mutationFn: (input: { id: string; title: string; content: string }) =>
      api(`/api/worlds/${worldId}/manuscripts/${selectedId}/chapters/${input.id}`, 'PATCH', {
        title: input.title,
        content: input.content
      }),
    onSuccess: () => {
      toast.success('章节已保存（回到草稿态）');
      setEditing(null);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message)
  });

  const compileAll = useMutation({
    mutationFn: async (chapterIds: string[]) => {
      let queued = 0;
      let chunks = 0;
      for (const id of chapterIds) {
        try {
          const result = await api<{
            totalChunks: number;
          }>(`/api/worlds/${worldId}/manuscripts/${selectedId}/chapters/${id}/finalize`, 'POST');
          queued += 1;
          chunks += result.totalChunks;
        } catch {
          // Keep the batch moving; individual failures remain visible in the
          // durable run status and can be resumed independently.
        }
      }
      return { queued, chunks };
    },
    onSuccess: (result) => {
      toast.success(
        `已提交 ${result.queued} 章 / 共 ${result.chunks} 个编译分块，完成后请到「审阅」合并`
      );
      refresh();
    },
    onError: (error: Error) => toast.error(error.message)
  });

  const advance = useMutation({
    mutationFn: () =>
      api<{ manuscript: ManuscriptRow }>(
        `/api/worlds/${worldId}/manuscripts/${selectedId}/cursor`,
        'POST',
        { advance: true }
      ),
    onSuccess: () => {
      toast.success('光标已推进到最新事件');
      refresh();
    },
    onError: (error: Error) => toast.error(error.message)
  });

  const generate = useMutation({
    mutationFn: () =>
      api<{ candidates: unknown[] }>(`/api/worlds/${worldId}/continuations`, 'POST', {
        manuscriptId: selectedId
      }),
    onSuccess: (result) => {
      toast.success(`已生成 ${result.candidates.length} 个候选（草稿态）`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message)
  });

  const accept = useMutation({
    mutationFn: (continuationId: string) =>
      api<unknown>(`/api/worlds/${worldId}/continuations/${continuationId}/accept`, 'POST'),
    onSuccess: () => {
      toast.success('已采纳：候选已转为待审变更');
      refresh();
    },
    onError: (error: Error) => toast.error(error.message)
  });

  const dismiss = useMutation({
    mutationFn: (continuationId: string) =>
      api<unknown>(`/api/worlds/${worldId}/continuations/${continuationId}/dismiss`, 'POST'),
    onSuccess: () => {
      toast.success('已忽略');
      refresh();
    },
    onError: (error: Error) => toast.error(error.message)
  });

  const [foreshadowTitle, setForeshadowTitle] = useState('');
  const [extractBusy, setExtractBusy] = useState(false);
  const foreshadows = useQuery({
    queryKey: ['foreshadows', worldId],
    queryFn: () =>
      api<{ foreshadows: { id: string; title: string; detail: string; status: string }[] }>(
        `/api/worlds/${worldId}/foreshadows`,
        'GET'
      )
  });
  const addForeshadow = useMutation({
    mutationFn: () => api(`/api/worlds/${worldId}/foreshadows`, 'POST', { title: foreshadowTitle }),
    onSuccess: () => {
      toast.success('伏笔已埋设（推演时会作为素材）');
      setForeshadowTitle('');
      void queryClient.invalidateQueries({ queryKey: ['foreshadows', worldId] });
    },
    onError: (error: Error) => toast.error(error.message)
  });
  const resolveForeshadow = useMutation({
    mutationFn: (input: { id: string; status: 'open' | 'resolved' }) =>
      api(`/api/worlds/${worldId}/foreshadows/${input.id}`, 'PATCH', { status: input.status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['foreshadows', worldId] }),
    onError: (error: Error) => toast.error(error.message)
  });

  const [newTitle, setNewTitle] = useState('');
  const [newSynopsis, setNewSynopsis] = useState('');
  const [newBulk, setNewBulk] = useState('');
  const manuscript = detail?.data?.manuscript;

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <span className='text-sm text-muted-foreground'>
          半成品接入 → 光标定位 → 推演候选 → 采纳/续写 → 定稿回编译 → 光标前移
        </span>
        <Button size='sm' onClick={() => setCreateOpen(true)}>
          <Icons.add className='mr-1 h-4 w-4' /> 新建/导入作品
        </Button>
      </div>

      {manuscripts.data?.manuscripts.length === 0 && (
        <p className='py-10 text-center text-sm text-muted-foreground'>
          还没有作品。把写到一半的文稿粘贴进来（用 --- 分隔章节），从当前进度继续生长。
        </p>
      )}

      {manuscripts.data?.manuscripts.length ? (
        <div className='flex flex-wrap gap-2'>
          {manuscripts.data.manuscripts.map((m) => (
            <div key={m.id} className='inline-flex items-center gap-1'>
              <Button
                key={m.id}
                size='sm'
                variant={selectedId === m.id ? 'default' : 'outline'}
                onClick={() => setSelectedId(m.id)}
              >
                {m.title}
                {m.pendingContinuations > 0 && (
                  <span className='ml-1 text-orange-400'>({m.pendingContinuations})</span>
                )}
              </Button>
              <Button
                size='sm'
                variant='outline'
                aria-label={`删除作品 ${m.title}`}
                onClick={() => {
                  if (window.confirm(`删除作品「${m.title}」及其全部章节？此操作不可恢复。`)) {
                    if (typeof removeManuscript !== 'undefined') removeManuscript.mutate(m.id);
                  }
                }}
              >
                <Icons.trash className='mr-1 h-3.5 w-3.5' /> 删除作品
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {manuscript && (
        <div className='space-y-4 rounded-lg border p-4'>
          <div className='flex flex-wrap items-center gap-3'>
            <span className='text-lg font-semibold'>{manuscript.title}</span>
            <Badge variant={manuscript.cursor ? 'default' : 'secondary'}>
              光标：
              {manuscript.cursor
                ? `${manuscript.cursor.epochYear !== null ? `${manuscript.cursor.epochYear} 年 · ` : ''}「${manuscript.cursor.title}」`
                : '未设置'}
            </Badge>
            <Button
              size='sm'
              variant='outline'
              disabled={advance.isPending}
              onClick={() => advance.mutate()}
            >
              光标推进到最新
            </Button>
          </div>
          {manuscript.synopsis && (
            <p className='text-sm text-muted-foreground'>{manuscript.synopsis}</p>
          )}

          <div className='flex items-center gap-2'>
            <span className='text-xs text-muted-foreground'>
              草稿 {manuscript.chapters.filter((c) => c.status !== 'final').length} 章 · 已定稿{' '}
              {manuscript.chapters.filter((c) => c.status === 'final').length} 章
            </span>
            <Button
              size='sm'
              className='ml-auto'
              disabled={
                compileAll.isPending || manuscript.chapters.every((c) => c.status === 'final')
              }
              onClick={() =>
                compileAll.mutate(
                  manuscript.chapters.filter((c) => c.status !== 'final').map((c) => c.id)
                )
              }
            >
              {compileAll.isPending ? (
                <Icons.spinner className='mr-1 h-4 w-4 animate-spin' />
              ) : (
                <Icons.upload className='mr-1 h-4 w-4' />
              )}
              一键编译全部草稿章节
            </Button>
          </div>
          <div className='space-y-2'>
            {manuscript.chapters.map((chapter) => (
              <div
                key={chapter.id}
                className='flex items-center gap-3 rounded-lg border p-3 text-sm'
              >
                <Badge variant={chapter.status === 'final' ? 'secondary' : 'outline'}>
                  {chapter.status === 'final' ? '已定稿' : '草稿'}
                </Badge>
                <span className='min-w-0 flex-1 truncate font-medium'>{chapter.title}</span>
                <span className='shrink-0 text-xs text-muted-foreground'>
                  {chapter.content.length.toLocaleString()} 字
                </span>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() =>
                    setViewing({
                      id: chapter.id,
                      title: chapter.title,
                      content: chapter.content,
                      status: chapter.status
                    })
                  }
                >
                  <Icons.search className='mr-1 h-3.5 w-3.5' /> 查看
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() =>
                    setEditing({ id: chapter.id, title: chapter.title, content: chapter.content })
                  }
                >
                  <Icons.edit className='mr-1 h-3.5 w-3.5' /> 编辑
                </Button>
                {chapter.status !== 'final' && (
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={finalizingId !== null}
                    onClick={() => finalize.mutate({ chapterId: chapter.id })}
                  >
                    {finalizingId === chapter.id ? (
                      <Icons.spinner className='h-4 w-4 animate-spin' />
                    ) : (
                      <Icons.upload className='h-4 w-4' />
                    )}
                    定稿回编译
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(next) => (next ? undefined : setEditing(null))}
      >
        <DialogContent className='max-h-[85vh] max-w-3xl overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>编辑章节（保存后回到草稿态，可再次定稿回编译）</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='ch-title'>章节标题</Label>
                <Input
                  id='ch-title'
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='ch-content'>正文</Label>
                <Textarea
                  id='ch-content'
                  rows={8}
                  className='max-h-[45vh] overflow-y-auto'
                  value={editing.content}
                  onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                />
              </div>
            </div>
          )}
          <div className='flex justify-end gap-2'>
            <Button variant='outline' onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button
              disabled={saveChapter.isPending || !editing?.content.trim()}
              onClick={() => editing && saveChapter.mutate(editing)}
            >
              {saveChapter.isPending ? '保存中…' : '保存'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className='space-y-2 rounded-lg border p-4'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-sm font-semibold'>伏笔</span>
          <span className='text-xs text-muted-foreground'>
            未回收伏笔会作为推演素材注入，候选应推进或回收它们
          </span>
        </div>
        <div className='flex gap-2'>
          <Input
            aria-label='伏笔标题'
            value={foreshadowTitle}
            onChange={(e) => setForeshadowTitle(e.target.value)}
            placeholder='例：残书的来历'
          />
          <Button
            size='sm'
            disabled={!foreshadowTitle.trim() || addForeshadow.isPending}
            onClick={() => addForeshadow.mutate()}
          >
            埋设
          </Button>
        </div>
        {foreshadows.data?.foreshadows.map((item) => (
          <div key={item.id} className='flex items-center gap-2 text-sm'>
            <Badge variant={item.status === 'resolved' ? 'secondary' : 'destructive'}>
              {item.status === 'resolved' ? '已回收' : '未回收'}
            </Badge>
            <span className='min-w-0 flex-1 truncate'>{item.title}</span>
            <Button
              size='sm'
              variant='ghost'
              onClick={() =>
                resolveForeshadow.mutate({
                  id: item.id,
                  status: item.status === 'resolved' ? 'open' : 'resolved'
                })
              }
            >
              {item.status === 'resolved' ? '重开' : '标记回收'}
            </Button>
          </div>
        ))}
        {(foreshadows.data?.foreshadows.length ?? 0) === 0 && (
          <p className='text-xs text-muted-foreground'>还没有伏笔。</p>
        )}
      </div>

      {selectedId && (
        <div className='space-y-3 rounded-lg border p-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='text-sm font-semibold'>推演候选</span>
            <span className='text-xs text-muted-foreground'>
              基于光标前世界状态生成（草稿态，采纳才进审阅链）
            </span>
            <Button
              size='sm'
              className='ml-auto'
              disabled={generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? (
                <Icons.spinner className='mr-1 h-4 w-4 animate-spin' />
              ) : (
                <Icons.sparkles className='mr-1 h-4 w-4' />
              )}
              生成候选
            </Button>
          </div>
          <div className='grid gap-2 md:grid-cols-2'>
            {continuations.data?.continuations.map((continuation) => (
              <div key={continuation.id} className='space-y-2 rounded-lg border p-3'>
                <div className='flex items-center gap-2'>
                  <Badge variant='outline'>
                    {KIND_LABELS[continuation.kind] ?? continuation.kind}
                  </Badge>
                  <span className='text-sm font-medium'>
                    {continuation.payload.title ??
                      (continuation.payload.relation
                        ? `${continuation.payload.relation.subject}—${continuation.payload.relation.relation}→${continuation.payload.relation.object}`
                        : '')}
                  </span>
                </div>
                <p className='text-xs text-muted-foreground'>{continuation.payload.summary}</p>
                {continuation.payload.relation && (
                  <p className='text-xs'>
                    {continuation.payload.relation.subject} —
                    {continuation.payload.relation.relation}→ {continuation.payload.relation.object}
                    （{continuation.payload.relation.polarity}）
                  </p>
                )}
                <p className='rounded bg-muted/40 p-2 text-xs text-muted-foreground'>
                  依据：{continuation.rationale}
                </p>
                {continuation.status === 'pending' && (
                  <div className='flex gap-2'>
                    <Button
                      size='sm'
                      variant='secondary'
                      disabled={accept.isPending}
                      onClick={() => accept.mutate(continuation.id)}
                    >
                      采纳
                    </Button>
                    <Button
                      size='sm'
                      variant='ghost'
                      disabled={dismiss.isPending}
                      onClick={() => dismiss.mutate(continuation.id)}
                    >
                      忽略
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {(continuations.data?.continuations.length ?? 0) === 0 && (
              <p className='text-xs text-muted-foreground'>
                暂无候选。生成后在此审阅：采纳会转为待审变更（不直接进正史）。
              </p>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={viewing !== null}
        onOpenChange={(next) => (next ? undefined : setViewing(null))}
      >
        <DialogContent className='max-h-[85vh] max-w-3xl overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>
              查看切片：{viewing?.title}（{viewing?.content.length.toLocaleString()} 字 ·{' '}
              {viewing?.status === 'final' ? '已定稿' : '草稿'}）
            </DialogTitle>
          </DialogHeader>
          <pre className='max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/20 p-3 text-xs leading-relaxed'>
            {viewing?.content}
          </pre>
          <div className='flex justify-end'>
            <Button variant='outline' onClick={() => setViewing(null)}>
              关闭
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={createOpen} onOpenChange={(next) => (next ? undefined : setCreateOpen(false))}>
        <DialogContent className='max-h-[85vh] max-w-2xl overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>新建 / 导入作品</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='ms-title'>作品名</Label>
              <Input
                id='ms-title'
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder='梦舟记'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ms-synopsis'>梗概（可选）</Label>
              <Input
                id='ms-synopsis'
                value={newSynopsis}
                onChange={(e) => setNewSynopsis(e.target.value)}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ms-file'>
                从文件导入（.md / .txt / .pdf / .epub{extractBusy ? ' · 提取中…' : ''}；导入后按 ---
                或章节标题自动分章）
              </Label>
              <Input
                id='ms-file'
                type='file'
                accept='.md,.markdown,.txt,.pdf,.epub,text/plain,text/markdown,application/pdf,application/epub+zip'
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const base = file.name.replace(/\.(md|markdown|txt|pdf|epub)$/i, '');
                  try {
                    if (/\.(pdf|epub)$/i.test(file.name)) {
                      // ISS-12：PDF/EPUB 走服务端提取
                      setExtractBusy(true);
                      const buffer = await file.arrayBuffer();
                      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
                      const response = await fetch(`/api/worlds/${worldId}/manuscripts/extract`, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ dataBase64: base64, filename: file.name })
                      });
                      const payload = (await response.json()) as {
                        text?: string;
                        error?: { message: string };
                      };
                      if (!response.ok || !payload.text)
                        throw new Error(payload.error?.message ?? '提取失败');
                      setNewBulk(payload.text);
                      toast.success(`已从 ${file.name} 提取 ${payload.text.length} 字符`);
                    } else {
                      const text = await file.text();
                      setNewBulk(text);
                      toast.success(`已读取 ${file.name}（${text.length} 字符）`);
                    }
                    if (!newTitle.trim()) setNewTitle(base);
                  } catch (error) {
                    toast.error((error as Error).message);
                  } finally {
                    setExtractBusy(false);
                  }
                }}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ms-bulk'>
                章节正文（用 --- 分隔多章；每章首行若为「第X章…」将作为章节标题）
              </Label>
              <Textarea
                id='ms-bulk'
                rows={8}
                className='35'
                value={newBulk}
                onChange={(e) => setNewBulk(e.target.value)}
              />
            </div>
          </div>
          <div className='flex justify-end gap-2'>
            <Button variant='outline' onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!newTitle.trim() || create.isPending}
              onClick={() => {
                create.mutate({ title: newTitle, synopsis: newSynopsis, bulk: newBulk });
                setNewTitle('');
                setNewSynopsis('');
                setNewBulk('');
              }}
            >
              {create.isPending ? '创建中…' : '创建'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
