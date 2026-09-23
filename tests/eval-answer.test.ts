import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/client';
import { createWorld } from '@/lib/worldbuilding/worlds';
import { submitChange } from '@/lib/governance/changes';
import { mergeWorld } from '@/lib/governance/merge';
import { runAnswerEval } from '@/lib/evals/answer';
import type { ChatResult } from '@/lib/llm/client';
import { LlmUsageBudgetError } from '@/lib/llm/usage-budget';

async function cleanDb() {
  await prisma.$transaction([
    prisma.tombstone.deleteMany(),
    prisma.conflictRecord.deleteMany(),
    prisma.evalRun.deleteMany(),
    prisma.evalCase.deleteMany(),
    prisma.qaRecord.deleteMany(),
    prisma.worldVersion.deleteMany(),
    prisma.change.deleteMany(),
    prisma.eventEdge.deleteMany(),
    prisma.relationshipEvent.deleteMany(),
    prisma.chronicleEvent.deleteMany(),
    prisma.entity.deleteMany(),
    prisma.epoch.deleteMany(),
    prisma.source.deleteMany(),
    prisma.world.deleteMany()
  ]);
}

const entityPayload = (name: string) => ({
  kind: 'character',
  name,
  aliases: [],
  summary: '',
  content: '',
  confidence: 'INFERRED',
  tags: [],
  sourceRefs: []
});

/** 队列式 fake chat：第 1 次调用是 askWorld 的回答，第 2 次是评审打分。 */
function fakeChat(responses: string[]) {
  const calls: string[] = [];
  const fn = async () => {
    const content = responses[Math.min(calls.length, responses.length - 1)];
    calls.push(content);
    return {
      content,
      profileId: 'fake',
      model: 'fake-chat',
      usage: null,
      latencyMs: 1
    } satisfies ChatResult;
  };
  return Object.assign(fn, { calls });
}

const brokenChat = async () => {
  throw new Error('模型不可达');
};

describe('P7-2 answer eval (LLM judge)', () => {
  let worldId: string;

  beforeEach(async () => {
    await cleanDb();
    worldId = (await createWorld({ name: '答案评测世界', premise: '评测' })).id;
    const change = async (kind: string, payload: Record<string, unknown>) => {
      const { change: row } = await submitChange(worldId, { kind, payload } as Parameters<
        typeof submitChange
      >[1]);
      return row.targetUid;
    };
    const a = await change('entity_upsert', entityPayload('云隐子'));
    const b = await change('entity_upsert', entityPayload('向顶天'));
    await change('relation_upsert', {
      subjectUid: b,
      objectUid: a,
      relation: '师徒',
      polarity: 'establish'
    });
    await mergeWorld(worldId);
    void a;
  });

  it('asks, judges by rubric, and persists an answer-mode run', async () => {
    const chat = fakeChat(['向顶天的师父是云隐子 [1]。', '{"score": 1, "reason": "要点全部命中"}']);
    const result = await runAnswerEval(
      worldId,
      [{ query: '向顶天的师父是谁', rubric: '必须指出云隐子是师父' }],
      { chatFn: chat }
    );

    expect(result.mode).toBe('answer');
    expect(chat.calls.length).toBe(2);
    expect(result.results[0].citationCount).toBeGreaterThan(0);
    expect(result.results[0].score).toBe(1);
    expect(result.score).toBe(1);

    const run = await prisma.evalRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run.mode).toBe('answer');
    expect(run.score).toBe(1);
  });

  it('shares one operation budget across every case and stops before the next model call', async () => {
    const envName = 'WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN';
    const previous = process.env[envName];
    process.env[envName] = '3';
    let calls = 0;
    const chatFn = async (request: { maxTokens?: number }): Promise<ChatResult> => {
      calls += 1;
      return {
        content: calls % 2 === 1 ? '向顶天的师父是云隐子 [1]。' : '{"score":1,"reason":"符合"}',
        profileId: 'deepseek-official',
        model: 'deepseek-flash',
        usage: { inputTokens: 1, outputTokens: Math.min(2, request.maxTokens ?? 2) },
        latencyMs: 1
      };
    };
    try {
      await expect(
        runAnswerEval(worldId, [{ query: '向顶天的师父是谁' }, { query: '向顶天是谁' }], { chatFn })
      ).rejects.toBeInstanceOf(LlmUsageBudgetError);

      expect(calls).toBe(2);
      expect(await prisma.evalRun.count({ where: { worldId, mode: 'answer' } })).toBe(0);
    } finally {
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
    }
  });

  it('keeps unparseable judge output as null score without fabricating', async () => {
    const chat = fakeChat(['向顶天的师父是云隐子 [1]。', '裁判罢工了，不给 JSON']);
    const result = await runAnswerEval(worldId, [{ query: '向顶天的师父是谁' }], { chatFn: chat });

    expect(result.results[0].score).toBeNull();
    expect(result.results[0].reason).toContain('评审输出无法解析');
    expect(result.score).toBe(0); // 无有效评分 → 均分 0，而不是编造
    const scored = (result.results as { score: number | null }[]).filter(
      (r) => typeof r.score === 'number'
    );
    expect(scored.length).toBe(0);
  });

  it('flags execution failures as skipped rows', async () => {
    const result = await runAnswerEval(worldId, [{ query: '任意问题' }], {
      chatFn: brokenChat as never
    });
    expect(result.results[0].skipped).toBe(true);
    expect(result.results[0].score).toBeNull();
  });
});
