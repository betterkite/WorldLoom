'use client';

import { useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { worldsQueryOptions } from '../api/queries';
import { CreateWorldDialog } from './create-world-dialog';
import { deleteWorldMutation } from '../api/mutations';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertModal } from '@/components/modal/alert-modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import PageContainer from '@/components/layout/page-container';
import { Icons } from '@/components/icons';
import Link from 'next/link';

export function WorldsHome() {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(worldsQueryOptions());
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const remove = useMutation({
    ...deleteWorldMutation,
    onSuccess: () => {
      toast.success('世界已删除');
      queryClient.invalidateQueries({ queryKey: ['worlds'] });
    },
    onError: (error: Error) => toast.error(error.message)
  });

  return (
    <PageContainer
      pageTitle='世界总览'
      pageDescription='每一个世界都是一条由变更审计链守护的编年史。'
      pageHeaderAction={
        <Button onClick={() => setCreateOpen(true)}>
          <Icons.add className='mr-2 h-4 w-4' /> 新建世界
        </Button>
      }
    >
      <div className='space-y-6 px-4 py-4 md:px-8'>
        <Heading title='世界' description={`共 ${data.worlds.length} 个世界`} />
        {data.worlds.length === 0 ? (
          <Card>
            <CardContent className='flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground'>
              <p>
                还没有世界。从一句前提开始，创世向导（Phase
                2）会把你的种子设定编译成完整的世界观与编年史。
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
            {data.worlds.map((world) => (
              <Link
                key={world.id}
                href={`/dashboard/worlds/${world.id}`}
                className='group'
                aria-label={`打开世界 ${world.name}`}
              >
                <Card className='h-full transition-colors group-hover:border-primary/40'>
                  <CardHeader>
                    <div className='flex items-center justify-between'>
                      <CardTitle className='text-base'>{world.name}</CardTitle>
                      <Badge variant={world.pendingChanges > 0 ? 'destructive' : 'secondary'}>
                        v{world.masterVersion}
                      </Badge>
                    </div>
                    <CardDescription className='line-clamp-2'>
                      {world.premise || '（暂无前提描述）'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className='flex items-center gap-4 text-xs text-muted-foreground'>
                    <Button
                      size='sm'
                      variant='ghost'
                      aria-label={`删除世界 ${world.name}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setPendingDelete({ id: world.id, name: world.name });
                      }}
                    >
                      <Icons.trash className='h-4 w-4' />
                    </Button>
                    <span className='inline-flex items-center gap-1'>
                      <Icons.product className='h-3.5 w-3.5' /> {world.entityCount} 条目
                    </span>
                    <span className='inline-flex items-center gap-1'>
                      <Icons.calendar className='h-3.5 w-3.5' /> {world.eventCount} 事件
                    </span>
                    {world.pendingChanges > 0 && (
                      <span className='ml-auto font-medium text-orange-500'>
                        {world.pendingChanges} 待审
                      </span>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
      <CreateWorldDialog open={createOpen} onOpenChange={setCreateOpen} />
      <AlertModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
        loading={remove.isPending}
        title={`删除世界「${pendingDelete?.name ?? ''}」`}
        description='将删除该世界的全部条目、事件、版本与素材，不可恢复。'
      />
    </PageContainer>
  );
}
