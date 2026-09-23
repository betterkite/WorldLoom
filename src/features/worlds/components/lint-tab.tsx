'use client';

import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { lintQueryOptions } from '../api/queries';
import { runLintMutation, updateLintFindingMutation } from '../api/mutations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { toast } from 'sonner';

const RULE_LABELS: Record<string, string> = {
  causal_inversion: '因果倒置',
  dangling_reference: '悬空引用',
  orphan_event: '孤儿事件',
  epoch_gap: '纪元断档',
  duplicate_name: '条目重名',
  self_relation: '自环关系',
  dead_participant: '亡者出场(启发式)'
};

const SEVERITY_LABELS: Record<string, string> = {
  error: '错误',
  warning: '警告',
  info: '提示'
};

export function LintTab({ worldId }: { worldId: string }) {
  const { data } = useSuspenseQuery(lintQueryOptions(worldId));
  const run = useMutation({
    ...runLintMutation(worldId),
    onSuccess: (r) =>
      toast.success(
        `体检完成：${r.counts.error} 错误 / ${r.counts.warning} 警告 / ${r.counts.fixed} 已自愈`
      ),
    onError: (e: Error) => toast.error(e.message)
  });
  const update = useMutation({
    ...updateLintFindingMutation(worldId),
    onSuccess: () => toast.success('已更新'),
    onError: (e: Error) => toast.error(e.message)
  });

  const open = data.findings.filter((f) => f.status === 'open');
  const dismissed = data.findings.filter((f) => f.status === 'ignored');

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <Button size='sm' disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? (
            <Icons.spinner className='mr-1 h-4 w-4 animate-spin' />
          ) : (
            <Icons.check className='mr-1 h-4 w-4' />
          )}
          运行体检
        </Button>
        <Badge variant='destructive'>
          {open.filter((f) => f.severity === 'error').length} 错误
        </Badge>
        <Badge variant='secondary'>
          {open.filter((f) => f.severity === 'warning').length} 警告
        </Badge>
        {dismissed.length > 0 && <Badge variant='outline'>{dismissed.length} 已忽略</Badge>}
        <span className='text-xs text-muted-foreground'>
          体检作用于主版本；合并新版本后旧发现自动转为「已自愈」。
        </span>
      </div>

      <div className='rounded-lg border border-dashed p-3 text-xs text-muted-foreground'>
        当前质量边界：规则体检（证据基于主版本）；语义审查尚未配置，启发式规则仅供人工参考，
        不会自动写入正史。
      </div>

      <div className='space-y-2'>
        {open.map((finding) => (
          <div key={finding.id} className='flex items-start gap-3 rounded-lg border p-3 text-sm'>
            <Badge variant={finding.severity === 'error' ? 'destructive' : 'secondary'}>
              {SEVERITY_LABELS[finding.severity] ?? finding.severity}
            </Badge>
            <div className='min-w-0 flex-1'>
              <span className='mr-2 text-xs font-medium'>
                {RULE_LABELS[finding.rule] ?? finding.rule}
              </span>
              <span className='text-muted-foreground'>{finding.message}</span>
            </div>
            <Button
              size='sm'
              variant='ghost'
              onClick={() => update.mutate({ findingId: finding.id, status: 'ignored' })}
            >
              忽略
            </Button>
          </div>
        ))}
        {dismissed.map((finding) => (
          <div
            key={finding.id}
            className='flex items-start gap-3 rounded-lg border border-dashed p-3 text-sm opacity-60'
          >
            <Badge variant='outline'>已忽略</Badge>
            <div className='min-w-0 flex-1'>
              <span className='mr-2 text-xs font-medium'>
                {RULE_LABELS[finding.rule] ?? finding.rule}
              </span>
              <span className='text-muted-foreground'>{finding.message}</span>
            </div>
            <Button
              size='sm'
              variant='ghost'
              onClick={() => update.mutate({ findingId: finding.id, status: 'open' })}
            >
              恢复
            </Button>
          </div>
        ))}
        {open.length === 0 && dismissed.length === 0 && (
          <p className='py-10 text-center text-sm text-muted-foreground'>
            没有发现。运行体检会检查因果倒置、悬空引用、孤儿事件、纪元断档、重名与亡者出场。
          </p>
        )}
      </div>
    </div>
  );
}
