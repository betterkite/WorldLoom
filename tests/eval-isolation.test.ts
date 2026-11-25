import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequest, ChatResult } from '@/lib/llm/client';

const state = vi.hoisted(() => ({
  world: { id: 'fixture', name: 'Fixture', masterVersion: 7, ingestMode: 'auto' },
  changes: [] as Record<string, unknown>[],
  qa: [] as Record<string, unknown>[],
  priorQuestions: [] as { question: string }[],
  qaReads: 0,
  searches: [] as { query: string; version: number | undefined }[],
  advance: false,
  emptyFirst: false,
  runs: [] as Record<string, unknown>[],
  merge: vi.fn(async () => ({ version: 8 }))
}));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    world: { findUnique: vi.fn(async () => ({ ...state.world })) },
    change: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'new-pending', ...data };
        state.changes.push(row);
        return row;
      }),
      count: vi.fn(async () => 2 + state.changes.length)
    },
    qaRecord: {
      findMany: vi.fn(async () => {
        state.qaReads += 1;
        return state.priorQuestions;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.qa.push(data);
        return { id: 'qa-fixture', ...data };
      })
    },
    evalRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'eval-fixture', ...data };
        state.runs.push(row);
        return row;
      }),
      findMany: vi.fn(async () => state.runs)
    }
  }
}));
vi.mock('@/lib/retrieval/search', () => ({
  searchWorld: vi.fn(async (_world: string, query: string, options: { version?: number }) => {
    const version = options.version ?? state.world.masterVersion;
    state.searches.push({ query, version: options.version });
    if (state.advance && state.searches.length === 1) state.world.masterVersion += 1;
    return {
      mode: 'lexical',
      hits:
        state.emptyFirst && state.searches.length === 1
          ? []
          : ['a', 'b'].map((uid) => ({
              kind: 'entity',
              uid,
              name: uid,
              summary: 'synthetic evidence'
            })),
      semantic: { version, expected: 2, indexed: 0, coverage: 0, fresh: false }
    };
  })
}));
vi.mock('@/lib/llm/client', () => ({
  chat: vi.fn(async () => {
    throw new Error('Real model forbidden');
  })
}));
vi.mock('@/lib/governance/merge', () => ({ mergeWorld: state.merge }));

import { runAnswerEval } from '@/lib/evals/answer';
import { listEvalRuns, runEval } from '@/lib/evals/run';
import { askWorld } from '@/lib/assistant/ask';

const question = '合成世界的两个人是谁';
const longAnswer = '仅测试控制流。[1][2]。'.repeat(12);
function fakeChat(contents: string[]) {
  let calls = 0;
  return vi.fn(async (_request: ChatRequest): Promise<ChatResult> => {
    if (calls >= contents.length) throw new Error('Unexpected extra model call');
    return {
      content: contents[calls++],
      profileId: 'fixture',
      model: 'fake',
      usage: null,
      latencyMs: 0
    };
  });
}
beforeEach(() => {
  state.world = { id: 'fixture', name: 'Fixture', masterVersion: 7, ingestMode: 'auto' };
  state.changes = [];
  state.qa = [];
  state.priorQuestions = [];
  state.searches = [];
  state.runs = [];
  state.advance = false;
  state.emptyFirst = false;
  state.qaReads = 0;
  state.merge.mockClear();
});

describe('evaluation and interactive Q&A boundaries', () => {
  it('does not write interactive history, stage changes or merge during evaluation', async () => {
    state.priorQuestions = Array.from({ length: 3 }, () => ({ question }));
    await runAnswerEval('fixture', [{ query: question }], {
      chatFn: fakeChat([longAnswer, '{"score":0.8}'])
    });
    expect(state.merge).not.toHaveBeenCalled();
    expect(state.changes).toHaveLength(0);
    expect(state.qa).toHaveLength(0);
    expect(state.qaReads).toBe(0);
    expect(state.runs).toHaveLength(1);
  });

  it('honors sediment=false even for repeated high-evidence answers', async () => {
    state.priorQuestions = Array.from({ length: 3 }, () => ({ question }));
    const result = await askWorld('fixture', {
      question,
      sediment: false,
      chatFn: fakeChat([longAnswer])
    });
    expect(result.qaId).toBe('qa-fixture');
    expect(state.changes).toHaveLength(0);
    expect(state.qa).toHaveLength(1);
    expect(state.qaReads).toBe(0);
    expect(state.merge).not.toHaveBeenCalled();
  });

  it.each([true, undefined])(
    'keeps interactive sediment=%s pending in legacy auto worlds',
    async (sediment) => {
      state.priorQuestions = Array.from({ length: 3 }, () => ({ question }));
      await askWorld('fixture', { question, sediment, chatFn: fakeChat([longAnswer]) });
      expect(state.changes).toHaveLength(1);
      expect(state.changes[0]).toMatchObject({
        status: 'pending',
        author: 'assistant',
        baseVersion: 7
      });
      expect(state.merge).not.toHaveBeenCalled();
      expect(state.qa[0]).toMatchObject({
        sedimentStatus: 'sedimented',
        sedimentChangeId: 'new-pending'
      });
    }
  );

  it.each(['2', '-1', '1e999', '"0.8"', 'null'])(
    'rejects invalid judge score %s without coercion',
    async (score) => {
      const result = await runAnswerEval('fixture', [{ query: question }], {
        chatFn: fakeChat([longAnswer, `{"score":${score}}`])
      });
      expect(result.results[0].score).toBeNull();
      expect(result).toMatchObject({ score: null, scoredCount: 0, totalCount: 1 });
      expect(state.runs[0].score).toBeNull();
    }
  );

  it('keeps malformed judge output unscored and reports the reason', async () => {
    const result = await runAnswerEval('fixture', [{ query: question }], {
      chatFn: fakeChat([longAnswer, 'invalid output'])
    });
    expect(result).toMatchObject({ score: null, scoredCount: 0, totalCount: 1 });
    expect(result.results[0].reason).toContain('无法解析');
  });

  it('shares a captured snapshot across all retrieval and answer cases', async () => {
    state.advance = true;
    const retrieval = await runEval('fixture', [
      { query: 'a', expectedUid: 'a' },
      { query: 'b', expectedUid: 'b' }
    ]);
    expect(retrieval.version).toBe(7);
    expect(retrieval.results.map((row) => row.semantic.version)).toEqual([7, 7]);
    state.world.masterVersion = 7;
    state.searches = [];
    const result = await runAnswerEval('fixture', [{ query: 'a' }, { query: 'b' }], {
      chatFn: fakeChat([longAnswer, '{"score":0}', longAnswer, '{"score":1}'])
    });
    expect(result).toMatchObject({ version: 7, score: 0.5, scoredCount: 2, totalCount: 2 });
    expect(state.searches.map((row) => row.version)).toEqual([7, 7]);
  });

  it('pins query rewriting to the same version and leaves no QA record', async () => {
    state.advance = true;
    state.emptyFirst = true;
    const result = await runAnswerEval('fixture', [{ query: question }], {
      chatFn: fakeChat(['改写后的合成查询', longAnswer, '{"score":1}'])
    });
    expect(result.score).toBe(1);
    expect(state.searches).toEqual([
      { query: question, version: 7 },
      { query: '改写后的合成查询', version: 7 }
    ]);
    expect(state.qa).toHaveLength(0);
  });

  it('normalizes unscored legacy aggregates without mutating stored rows or real zero scores', async () => {
    state.runs = [
      { id: 'unknown', mode: 'answer', score: 0, results: [{ score: null }] },
      { id: 'zero', mode: 'answer', score: 0, results: [{ score: 0 }] }
    ];
    const runs = await listEvalRuns('fixture');
    expect(runs.map((row) => row.score)).toEqual([null, 0]);
    expect(state.runs[0].score).toBe(0);
  });
});
