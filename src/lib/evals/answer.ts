import { prisma } from '@/lib/db/client';
import { requireWorld } from '@/lib/governance/changes';
import { askWorld } from '@/lib/assistant/ask';
import { chat as defaultChat } from '@/lib/llm/client';
import type { ChatResult } from '@/lib/llm/client';

/**
 * P7-2 收尾：LLM 答案评测。
 * 每个用例 = 问题 + 评分要点（rubric）。流程：askWorld 生成带引用的回答 →
 * LLM-as-judge 按 rubric 打分（0~1，JSON 输出）→ 汇总为 mode='answer' 的 EvalRun。
 * 评审输出无法解析时该例 score=null（不计入均分，reason 说明），绝不编造分数。
 */

type ChatFn = (request: {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature?: number;
  maxTokens?: number;
}) => Promise<ChatResult>;

export interface AnswerCaseInput {
  query: string;
  rubric?: string;
}

export interface AnswerEvalRow {
  caseId: string;
  query: string;
  answer: string;
  citationCount: number;
  score: number | null;
  reason: string;
  skipped?: boolean;
}

const JUDGE_SYSTEM = `你是严格的世界观评测裁判。根据「评分要点」给助手回答打分，只输出 JSON：
{"score": 0到1之间的小数, "reason": "一句话理由"}
规则：回答必须完全依据给出的世界设定事实；符合全部要点给接近 1 的分；编造设定、外部知识或遗漏关键要点扣分；完全无关给 0。`;

function extractJson(text: string): { score?: unknown; reason?: unknown } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function judgeOnce(
  chat: ChatFn,
  question: string,
  answer: string,
  rubric: string
): Promise<{ score: number | null; reason: string }> {
  const user = [
    rubric ? `评分要点：${rubric}` : '评分要点：回答准确、有据可依、完整回应问题。',
    `问题：${question}`,
    `助手回答：\n${answer}`
  ].join('\n\n');
  const result = await chat({
    messages: [
      { role: 'system', content: JUDGE_SYSTEM },
      { role: 'user', content: user }
    ],
    temperature: 0,
    maxTokens: 300
  });
  const parsed = extractJson(result.content);
  const score = typeof parsed?.score === 'number' ? Math.min(1, Math.max(0, parsed.score)) : null;
  const reason = typeof parsed?.reason === 'string' ? parsed.reason : '';
  if (score === null)
    return { score: null, reason: `评审输出无法解析：${result.content.slice(0, 80)}` };
  return { score, reason };
}

export async function runAnswerEval(
  worldId: string,
  cases: AnswerCaseInput[],
  options: { chatFn?: ChatFn } = {}
) {
  const world = await requireWorld(worldId);
  const chat = options.chatFn ?? defaultChat;
  const results: AnswerEvalRow[] = [];

  for (const c of cases) {
    try {
      const answer = await askWorld(worldId, { question: c.query, chatFn: options.chatFn });
      const judge = await judgeOnce(chat, c.query, answer.answer, c.rubric ?? '');
      results.push({
        caseId: globalThis.crypto.randomUUID(),
        query: c.query,
        answer: answer.answer,
        citationCount: answer.citations.length,
        score: judge.score,
        reason: judge.reason
      });
    } catch (error) {
      results.push({
        caseId: globalThis.crypto.randomUUID(),
        query: c.query,
        answer: '',
        citationCount: 0,
        score: null,
        reason: `执行失败：${(error as Error).message.slice(0, 120)}`,
        skipped: true
      });
    }
  }

  const scored = results.filter(
    (r): r is AnswerEvalRow & { score: number } => typeof r.score === 'number'
  );
  const score = scored.length ? scored.reduce((sum, r) => sum + r.score, 0) / scored.length : 0;
  const run = await prisma.evalRun.create({
    data: {
      worldId,
      version: world.masterVersion,
      mode: 'answer',
      score: Number(score.toFixed(4)),
      results: results as object[]
    }
  });
  return {
    runId: run.id,
    version: run.version,
    mode: 'answer' as const,
    score: run.score,
    results
  };
}
