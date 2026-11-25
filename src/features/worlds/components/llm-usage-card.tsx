'use client';

import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatLlmUsageCount as format } from '@/lib/llm/usage-summary';
import { fetchLlmUsage, LlmUsageReadError } from '../api/usage';

export function LlmUsageCard() {
  const { data, error, isError, isFetching, refetch } = useQuery({
    queryKey: ['llm-usage'],
    queryFn: ({ signal }) => fetchLlmUsage({ signal }),
    staleTime: 30_000,
    retry: false,
    throwOnError: false,
    refetchOnWindowFocus: false
  });
  return (
    <Card aria-label='累计模型用量' aria-busy={isFetching}>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <CardTitle className='text-base'>累计模型用量</CardTitle>
          <Button variant='outline' size='sm' disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? '正在读取...' : '刷新用量'}
          </Button>
        </div>
        <CardDescription>
          本机成功记录的模型调用尝试（含重试）；非实时统计，可手动刷新，此统计不设置消费额度。
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        {isError && (
          <p role='alert'>
            {error instanceof LlmUsageReadError ? error.message : '累计模型用量暂时无法读取'}；
            请检查服务、数据库和迁移后刷新；不表示累计用量为零。
            {data ? '下方保留上次成功读取的快照，不是当前用量。' : ''}
          </p>
        )}
        {!data ? (
          !isError && <p role='status'>正在读取累计用量...</p>
        ) : (
          <>
            <p role='status' className='text-xs text-muted-foreground'>
              {isError || isFetching ? '上次成功读取快照（非当前值）' : '统计快照'}：
              {new Date(data.updatedAt).toLocaleString('zh-CN')}。
              {isFetching ? '正在更新...' : '新调用或重启后的变化请刷新确认。'}
            </p>
            <dl className='grid grid-cols-2 gap-3 md:grid-cols-4'>
              <div>
                <dt className='text-muted-foreground'>已记录调用尝试</dt>
                <dd className='break-all tabular-nums'>{format(data.totals.calls)}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>已知输入 token</dt>
                <dd className='break-all tabular-nums'>{format(data.totals.inputTokens)}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>已知输出 token</dt>
                <dd className='break-all tabular-nums'>{format(data.totals.outputTokens)}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>已知总 token</dt>
                <dd className='break-all tabular-nums'>{format(data.totals.totalTokens)}</dd>
              </div>
            </dl>
            <p className='text-muted-foreground'>
              完整用量 {format(data.totals.knownUsageCalls)} 次；未知用量{' '}
              {format(data.totals.unknownUsageCalls)} 次； 待结算/中断{' '}
              {format(data.totals.pendingCalls)} 次；失败 {format(data.totals.failedCalls)} 次。
              失败尝试也可能产生已知用量。 已知 token
              不包含未知调用，不能据此推算完整账单或账户余额。
            </p>
            {data.profiles.map((profile) => (
              <div
                key={JSON.stringify([profile.profileId, profile.model])}
                className='flex flex-wrap justify-between gap-2 border-t pt-2'
              >
                <span className='break-all'>
                  {profile.profileId} · {profile.model}
                </span>
                <span className='break-all'>
                  {format(profile.calls)} 次 / {format(profile.totalTokens)} token
                </span>
              </div>
            ))}
            <p className='text-xs text-muted-foreground'>
              {data.recordedFrom
                ? `最早已记录尝试：${new Date(data.recordedFrom).toLocaleString('zh-CN')}。`
                : '尚无已记录尝试。'}
              仅覆盖启用统计后的成功写入记录，不是 provider 全部历史；记录异常可能有缺漏，worker
              异常请检查其日志。
            </p>
            {data.recording.currentProcessWriteFailures !== '0' && (
              <p role='alert' className='text-amber-600 dark:text-amber-400'>
                该快照中的 Web 进程报告 {format(data.recording.currentProcessWriteFailures)}{' '}
                次统计写入失败或超时，累计记录可能不完整。
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
