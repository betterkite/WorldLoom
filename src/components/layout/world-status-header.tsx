'use client';

import { useQuery } from '@tanstack/react-query';
import { worldQueryOptions } from '@/features/worlds/api/queries';
import type { WorldSummary } from '@/features/worlds/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type WorldStatus = Pick<WorldSummary, 'id' | 'name' | 'masterVersion' | 'pendingChanges'>;

export function WorldStatusHeader({ initialWorld }: { initialWorld: WorldStatus }) {
  const { data, isError, isFetching, refetch } = useQuery(worldQueryOptions(initialWorld.id));
  const world = data?.world ?? initialWorld;

  return (
    <div className='flex flex-wrap items-center gap-3'>
      <h1 className='text-2xl font-semibold'>{world.name}</h1>
      <Badge>v{world.masterVersion}</Badge>
      {world.pendingChanges > 0 && <Badge variant='destructive'>{world.pendingChanges} 待审</Badge>}
      {isError && (
        <div role='alert' className='flex items-center gap-2 text-sm text-destructive'>
          世界状态更新失败，当前显示上次状态。
          <Button size='sm' variant='outline' disabled={isFetching} onClick={() => void refetch()}>
            重试
          </Button>
        </div>
      )}
    </div>
  );
}
