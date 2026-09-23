'use client';

import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Ops = {
  masterVersion: number;
  health: 'healthy' | 'ok' | 'attention';
  intake: {
    total: number;
    staged: number;
    compiled: number;
    failed: number;
    failedList: { id: string; filename: string }[];
  };
  review: { pending: number; merged: number };
  lint: { error: number; warning: number; ignored: number };
  continuation: { pending: number };
  qa: { last7d: number; total: number };
  studio: { manuscripts: number; chaptersDraft: number; chaptersFinal: number };
  semanticIndex: {
    version: number;
    expected: number;
    indexed: number;
    coverage: number;
    fresh: boolean;
    lastIndexedAt: string | null;
    embeddingModel: string | null;
    reason: string | null;
  };
  semanticIndexJob: {
    status: 'queued' | 'running' | 'completed' | 'failed';
    attempts: number;
    indexed: number;
    error: string | null;
  } | null;
  contracts: { id: string; name: string; usedBy: string; fields: string; tolerance: string }[];
  compilerStats: { author: string; changes: number }[];
  recentVersions: {
    version: number;
    summary: string;
    changeCount: number;
    conflictCount: number;
    createdAt: string;
  }[];
};

const semanticReasonLabel: Record<string, string> = {
  no_index: '尚未建立',
  stale_index: '内容已过期',
  semantic_unconfigured: '未配置向量服务',
  disabled_by_request: '已按请求关闭',
  no_targets: '暂无可索引内容'
};

const cards: {
  key: string;
  label: (o: Ops) => string;
  detail: (o: Ops) => string;
  tone: (o: Ops) => string;
}[] = [
  {
    key: 'intake',
    label: () => '素材摄入',
    detail: (o) =>
      `${o.intake.total} 个（待编译 ${o.intake.staged} · 已编译 ${o.intake.compiled} · 失败 ${o.intake.failed}）`,
    tone: (o) => (o.intake.failed > 0 ? 'destructive' : 'secondary')
  },
  {
    key: 'review',
    label: () => '审阅链',
    detail: (o) => `待审 ${o.review.pending} · 已合并 ${o.review.merged}`,
    tone: (o) => (o.review.pending > 0 ? 'default' : 'secondary')
  },
  {
    key: 'lint',
    label: () => '一致性',
    detail: (o) => `错误 ${o.lint.error} · 警告 ${o.lint.warning} · 已忽略 ${o.lint.ignored}`,
    tone: (o) => (o.lint.error > 0 ? 'destructive' : 'secondary')
  },
  {
    key: 'continuation',
    label: () => '推演',
    detail: (o) => `${o.continuation.pending} 条候选待审`,
    tone: () => 'secondary'
  },
  {
    key: 'qa',
    label: () => '世界知识助手',
    detail: (o) => `7 天 ${o.qa.last7d} 问 · 累计 ${o.qa.total}`,
    tone: () => 'secondary'
  },
  {
    key: 'studio',
    label: () => '创作台',
    detail: (o) =>
      `${o.studio.manuscripts} 作品 · 草稿 ${o.studio.chaptersDraft} · 定稿 ${o.studio.chaptersFinal}`,
    tone: () => 'secondary'
  }
];

export function OpsTab({ worldId }: { worldId: string }) {
  const { data } = useSuspenseQuery({
    queryKey: ['ops', worldId],
    queryFn: async () => {
      const response = await fetch(`/api/worlds/${worldId}/ops`);
      if (!response.ok) throw new Error('加载失败');
      return (await response.json()) as Ops;
    }
  });

  const worlds = useQuery({
    queryKey: ['worlds'],
    queryFn: async () => {
      const response = await fetch('/api/worlds');
      return (await response.json()) as { worlds: { id: string; name: string }[] };
    }
  });
  const router = useRouter();

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-xs text-muted-foreground'>选择世界</span>
        <select
          id='world-select'
          aria-label='选择世界'
          className='rounded-md border bg-background px-2 py-1 text-sm'
          value={worldId}
          onChange={(event) => router.push(`/dashboard/worlds/${event.target.value}/ops`)}
        >
          {worlds.data?.worlds.map((world) => (
            <option key={world.id} value={world.id}>
              {world.name}
            </option>
          ))}
        </select>
      </div>
      <div className='flex items-center gap-2'>
        <Badge
          variant={
            data.health === 'healthy'
              ? 'secondary'
              : data.health === 'attention'
                ? 'destructive'
                : 'default'
          }
        >
          {data.health === 'healthy'
            ? '运行健康'
            : data.health === 'attention'
              ? '需要关注'
              : '正常'}
        </Badge>
        <span className='text-xs text-muted-foreground'>主版本 v{data.masterVersion}</span>
      </div>
      <div className='flex flex-wrap items-center gap-2 rounded-lg border p-3 text-xs'>
        <span className='font-semibold'>语义索引</span>
        <Badge variant={data.semanticIndex.fresh ? 'secondary' : 'outline'}>
          {data.semanticIndex.fresh ? '新鲜' : '未就绪'}
        </Badge>
        <span className='text-muted-foreground'>
          v{data.semanticIndex.version} · {data.semanticIndex.indexed}/{data.semanticIndex.expected}{' '}
          条 · 覆盖率 {Math.round(data.semanticIndex.coverage * 100)}%
        </span>
        {data.semanticIndex.embeddingModel && (
          <span className='text-muted-foreground'>模型 {data.semanticIndex.embeddingModel}</span>
        )}
        {!data.semanticIndex.fresh && data.semanticIndex.reason && (
          <span className='text-muted-foreground'>
            （{semanticReasonLabel[data.semanticIndex.reason] ?? data.semanticIndex.reason}）
          </span>
        )}
        {data.semanticIndex.lastIndexedAt && (
          <span className='text-muted-foreground'>
            最近更新 {new Date(data.semanticIndex.lastIndexedAt).toLocaleString('zh-CN')}
          </span>
        )}
        {data.semanticIndexJob && data.semanticIndexJob.status !== 'completed' && (
          <span className={data.semanticIndexJob.status === 'failed' ? 'text-destructive' : ''}>
            后台任务：
            {data.semanticIndexJob.status === 'queued'
              ? '排队中'
              : data.semanticIndexJob.status === 'running'
                ? '运行中'
                : '失败'}
          </span>
        )}
      </div>
      <div className='grid gap-3 md:grid-cols-2 lg:grid-cols-3'>
        {cards.map(
          (card: {
            key: string;
            label: (o: Ops) => string;
            detail: (o: Ops) => string;
            tone: (o: Ops) => string;
          }) => (
            <Card key={card.key}>
              <CardHeader className='pb-1'>
                <CardTitle className='text-sm font-medium text-muted-foreground'>
                  {card.label(data)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant={card.tone(data) as 'secondary' | 'destructive' | 'default'}>
                  {card.detail(data)}
                </Badge>
              </CardContent>
            </Card>
          )
        )}
      </div>
      {data.intake.failedList.length > 0 && (
        <div className='space-y-1 rounded-lg border p-3'>
          <p className='text-xs font-semibold text-destructive'>失败素材</p>
          {data.intake.failedList.map((source) => (
            <p key={source.id} className='truncate text-xs text-muted-foreground'>
              {source.filename}
            </p>
          ))}
        </div>
      )}
      <ContractsSection ops={data} />

      <div className='space-y-1 rounded-lg border p-3'>
        <p className='mb-1 text-xs font-semibold text-muted-foreground'>最近版本</p>
        {data.recentVersions.map((version) => (
          <p key={version.version} className='text-xs'>
            <Badge variant='outline' className='mr-2'>
              v{version.version}
            </Badge>
            {version.summary}（{version.changeCount} 变更 / {version.conflictCount} 冲突）
          </p>
        ))}
      </div>
    </div>
  );
}

// P7-4 业务知识：数据契约展示
export function ContractsSection({ ops }: { ops: Ops }) {
  return (
    <div className='space-y-3 rounded-lg border p-4'>
      <div className='flex items-center gap-2'>
        <span className='text-sm font-semibold'>业务知识 · LLM 数据契约</span>
        <span className='text-xs text-muted-foreground'>
          所有生成物必须通过对应契约校验才能进入审阅链
        </span>
      </div>
      <div className='flex flex-wrap gap-2'>
        {ops.compilerStats.map((stat) => (
          <Badge key={stat.author} variant='secondary' className='text-xs'>
            {stat.author}: {stat.changes} 变更
          </Badge>
        ))}
      </div>
      <div className='space-y-2'>
        {ops.contracts.map((contract) => (
          <div key={contract.id} className='rounded-lg border p-3 text-xs'>
            <div className='flex items-center gap-2'>
              <Badge variant='outline'>{contract.name}</Badge>
              <span className='text-muted-foreground'>{contract.usedBy}</span>
            </div>
            <p className='mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground'>
              {contract.fields}
            </p>
            <p className='mt-1 text-[11px]'>容错：{contract.tolerance}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
