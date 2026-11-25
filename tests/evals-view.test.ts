import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EvalsView } from '@/features/evals/components/evals-view';

const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});
function render(runs: object[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Network forbidden');
    })
  );
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } }
  });
  clients.push(client);
  client.setQueryData(['worlds'], { worlds: [{ id: 'fixture', name: '合成世界' }] });
  client.setQueryData(['eval-targets', 'fixture'], []);
  client.setQueryData(['evals', 'fixture'], { runs, cases: [] });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client, children: createElement(EvalsView) })
  );
}
function answer(id: string, score: number | null, results: object[]) {
  return { id, score, results, version: 2, mode: 'answer', createdAt: '2026-11-07T00:00:00Z' };
}

it('renders legacy all-failed results as unscored and excludes them from ranking', () => {
  const html = render([
    answer('unknown', 0, [{ query: '失败问题', score: null, reason: '裁判输出异常' }]),
    answer('zero', 0, [{ query: '有效零分', score: 0, reason: '完全不符' }])
  ]);
  expect(html).toContain('未评分');
  expect(html).toContain('有效评分 0/1 例');
  expect(html).toContain('裁判输出异常');
  expect(html).toContain('#1');
  expect(html).not.toContain('#2');
});

it('shows a legitimate zero score and the effective sample count', () => {
  const html = render([
    answer('zero', 0, [
      { query: '零分问题', score: 0, reason: '不符' },
      { query: '失败问题', score: null, reason: '不可用' }
    ])
  ]);
  expect(html).toContain('均分 0');
  expect(html).toContain('有效评分 1/2 例');
});

it('does not rank runs when every run has no valid score', () => {
  const html = render([
    answer('one', null, [{ score: null, query: '一', reason: '不可用' }]),
    answer('two', 0, [{ score: null, query: '二', reason: '不可用' }])
  ]);
  expect(html).toContain('暂无有效评分，不参与排名。');
  expect(html).not.toContain('#1');
});

it('renders a nullable historical retrieval aggregate safely', () => {
  const html = render([
    {
      id: 'retrieval',
      score: null,
      version: 1,
      mode: 'lexical',
      results: [],
      createdAt: '2026-11-07T00:00:00Z'
    }
  ]);
  expect(html).toContain('未评分');
  expect(html).not.toContain('命中率 0%');
});
