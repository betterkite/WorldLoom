'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { createWorldMutation } from '../api/mutations';
import { getQueryClient } from '@/lib/query-client';
import { worldKeys } from '../api/queries';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

export function CreateWorldDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [premise, setPremise] = useState('');
  const [ingestMode, setIngestMode] = useState<'review' | 'auto'>('review');
  const mutation = useMutation({
    ...createWorldMutation,
    onSuccess: () => {
      // 立即重新拉取列表，避免"创建后要手动刷新才出现"
      void getQueryClient().refetchQueries({ queryKey: worldKeys.list() });
      toast.success('世界已创建');
      setName('');
      setPremise('');
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message)
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建世界</DialogTitle>
          <DialogDescription>
            先立一个名字和一句话前提；创世向导将在 Phase 2 接手扩展。
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='world-name'>名称</Label>
            <Input
              id='world-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='例：九洲风物志'
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='world-premise'>一句话前提</Label>
            <Textarea
              id='world-premise'
              value={premise}
              onChange={(e) => setPremise(e.target.value)}
              placeholder='这个世界服务于什么故事？'
            />
          </div>
          <div className='space-y-2'>
            <Label>变更模式</Label>
            <div className='flex gap-2'>
              {(['review', 'auto'] as const).map((mode) => (
                <Button
                  key={mode}
                  type='button'
                  size='sm'
                  variant={ingestMode === mode ? 'default' : 'outline'}
                  onClick={() => setIngestMode(mode)}
                >
                  {mode === 'review' ? 'review（逐条审阅）' : 'auto（满 3 条自动合并）'}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!name.trim() || mutation.isPending}
            onClick={() => mutation.mutate({ name, premise, ingestMode })}
          >
            {mutation.isPending ? '创建中…' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
