'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { submitEntityChangeMutation } from '../api/mutations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Icons } from '@/components/icons';
import { toast } from 'sonner';

interface AskResponse {
  qaId: string;
  question: string;
  answer: string;
  citations: { n: number; kind: string; uid: string; name: string }[];
  retrieval: {
    mode: string;
    hits: number;
    rewritten: string | null;
    semantic: { indexed: number; expected: number; coverage: number; fresh: boolean };
  };
}

export function AssistantTab({ worldId }: { worldId: string }) {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<AskResponse[]>([]);
  const ask = useMutation({
    mutationFn: async (q: string): Promise<AskResponse> => {
      const response = await fetch(`/api/worlds/${worldId}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'ask failed');
      return body as AskResponse;
    },
    onSuccess: (result) => {
      setHistory((prev) => [...prev, result]);
      void queryClient.invalidateQueries({ queryKey: ['qa-history', worldId] });
    },
    onError: (error: Error) => toast.error(error.message)
  });
  const sediment = useMutation({ ...submitEntityChangeMutation(worldId) });
  const queryClient = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);
  const qaHistory = useQuery({
    queryKey: ['qa-history', worldId],
    queryFn: async () => {
      const response = await fetch(`/api/worlds/${worldId}/qa?limit=50`);
      if (!response.ok) throw new Error('历史加载失败');
      return (await response.json()) as {
        records: {
          id: string;
          question: string;
          answer: string;
          citations: { name: string }[];
          sedimentStatus: string;
          createdAt: string;
        }[];
      };
    },
    enabled: showHistory
  });

  const submit = () => {
    if (!question.trim() || ask.isPending) return;
    ask.mutate(question.trim());
    setQuestion('');
  };

  return (
    <div className='space-y-4'>
      <div className='space-y-3'>
        {history.length === 0 && (
          <p className='py-8 text-center text-sm text-muted-foreground'>
            向你的世界提问（世界知识助手）。回答只依据世界设定并逐条引用 [n]；证据不足会明说。
          </p>
        )}
        {history.map((entry, index) => (
          <div key={`${entry.qaId}-${index}`} className='space-y-2 rounded-lg border p-4'>
            <div className='flex items-center gap-2'>
              <Badge variant='outline'>{entry.retrieval.mode}</Badge>
              {entry.retrieval.semantic.expected > 0 && (
                <Badge variant={entry.retrieval.semantic.fresh ? 'secondary' : 'outline'}>
                  索引 {entry.retrieval.semantic.indexed}/{entry.retrieval.semantic.expected}
                </Badge>
              )}
              <span className='text-sm font-medium'>{entry.question}</span>
              {entry.retrieval.rewritten && (
                <span className='text-xs text-muted-foreground'>
                  （改写：{entry.retrieval.rewritten}）
                </span>
              )}
            </div>
            <p className='whitespace-pre-wrap text-sm leading-relaxed'>{entry.answer}</p>
            <div className='flex flex-wrap items-center gap-1.5'>
              {entry.citations.map((citation) => (
                <Badge key={citation.uid} variant='secondary' className='text-xs'>
                  [{citation.n}] {citation.kind === 'event' ? '◆' : '■'} {citation.name}
                </Badge>
              ))}
              <Button
                size='sm'
                variant='ghost'
                className='ml-auto text-xs'
                disabled={sediment.isPending}
                onClick={() =>
                  sediment.mutate(
                    {
                      payload: {
                        kind: 'concept',
                        name: `问答：${entry.question.slice(0, 40)}`,
                        aliases: [],
                        summary: entry.answer.slice(0, 200),
                        content: `**问**：${entry.question}\n\n**答**：${entry.answer}\n\n**引用**：${entry.citations.map((c) => c.name).join('、')}`,
                        confidence: 'INFERRED',
                        tags: ['qa-sediment'],
                        sourceRefs: []
                      }
                    },
                    { onSuccess: () => toast.success('已沉淀为条目草稿（待审）') }
                  )
                }
              >
                <Icons.add className='mr-1 h-3 w-3' /> 沉淀为条目
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className='flex gap-2'>
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder='例：向顶天和守梦人是什么关系？'
          aria-label='提问'
        />
        <Button disabled={!question.trim() || ask.isPending} onClick={submit}>
          {ask.isPending ? <Icons.spinner className='h-4 w-4 animate-spin' /> : '提问'}
        </Button>
        <Button variant='outline' onClick={() => setShowHistory((prev) => !prev)}>
          {showHistory ? '收起历史' : '历史问答'}
        </Button>
      </div>

      {showHistory && (
        <div className='space-y-2 rounded-lg border p-4'>
          <p className='text-sm font-semibold'>历史问答（{qaHistory.data?.records.length ?? 0}）</p>
          {qaHistory.data?.records.map((record) => (
            <div key={record.id} className='space-y-1 rounded-lg border p-3 text-sm'>
              <div className='flex items-center gap-2'>
                <span className='font-medium'>{record.question}</span>
                {record.sedimentStatus === 'sedimented' && (
                  <Badge variant='secondary' className='text-xs'>
                    已沉淀
                  </Badge>
                )}
                <span className='ml-auto text-xs text-muted-foreground'>
                  {new Date(record.createdAt).toLocaleString('zh-CN')}
                </span>
              </div>
              <p className='line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground'>
                {record.answer}
              </p>
              <div className='flex flex-wrap gap-1'>
                {record.citations.map((citation, index) => (
                  <Badge key={`${record.id}-${index}`} variant='outline' className='text-xs'>
                    {citation.name}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
          {qaHistory.data?.records.length === 0 && (
            <p className='py-4 text-center text-xs text-muted-foreground'>还没有历史问答。</p>
          )}
        </div>
      )}
    </div>
  );
}
