import { prisma } from '@/lib/db/client';
import { searchWorld } from '@/lib/retrieval/search';
import type { SemanticIndexStatus } from '@/lib/retrieval/search';
import { chat as defaultChat } from '@/lib/llm/client';
import type { ChatMessage, ChatResult } from '@/lib/llm/client';

/**
 * Creation assistant (Phase 4, ADR-014): evidence-constrained Q&A.
 * Only answer from retrieved world content, cite [n], say when evidence is
 * insufficient. Zero-evidence first pass triggers one LLM query rewrite and
 * re-retrieval. Every run is recorded as a QaRecord.
 */

export interface AskResult {
  qaId: string;
  question: string;
  answer: string;
  citations: { n: number; kind: string; uid: string; name: string }[];
  retrieval: {
    mode: string;
    hits: number;
    rewritten: string | null;
    semantic: SemanticIndexStatus;
  };
}

const SYSTEM_ANSWER = `你是世界观创作助手。回答规则：
1. 只依据 <evidence> 里的世界设定回答，不得使用任何外部知识或编造设定。
2. 每个实质性论断后标注来源编号，如 [1]、[2]。
3. 证据不足或没有相关设定时，明确回答「现有设定中未找到足够依据」，并列出缺失什么。
4. 风格：简洁、面向创作者。`;

export async function askWorld(
  worldId: string,
  input: {
    question: string;
    topK?: number;
    sediment?: boolean;
    chatFn?: (request: {
      messages: ChatMessage[];
      temperature?: number;
      maxTokens?: number;
    }) => Promise<ChatResult>;
    searchOptions?: { embedFn?: (texts: string[]) => Promise<number[][]> };
  }
): Promise<AskResult> {
  const chat = input.chatFn ?? defaultChat;
  const world = await prisma.world.findUnique({ where: { id: worldId } });
  if (!world) throw new Error(`World not found: ${worldId}`);

  const question = String(input.question ?? '').trim();
  if (!question) throw new Error('question is required');

  let search = await searchWorld(worldId, question, {
    topK: input.topK ?? 6,
    embedFn: input.searchOptions?.embedFn
  });
  let rewritten: string | null = null;

  // RAG phase 2 (Q9): zero evidence → one LLM rewrite + re-retrieval
  if (search.hits.length === 0) {
    rewritten = await rewriteQuestion(question, chat);
    if (rewritten && rewritten !== question) {
      const retry = await searchWorld(worldId, rewritten, {
        topK: input.topK ?? 6,
        embedFn: input.searchOptions?.embedFn
      });
      if (retry.hits.length > 0) search = retry;
    }
  }

  const citations = search.hits.map((hit, index) => ({
    n: index + 1,
    kind: hit.kind,
    uid: hit.uid,
    name: hit.name
  }));

  let answer: string;
  if (search.hits.length === 0) {
    answer = '现有设定中未找到足够依据，无法回答这个问题。可以考虑先补充相关条目或事件。';
  } else {
    const evidence = search.hits
      .map(
        (hit, index) =>
          `[${index + 1}] ${hit.kind === 'event' ? '事件' : '条目'}「${hit.name}」：${hit.summary || hit.name}`
      )
      .join('\n\n');
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_ANSWER },
      { role: 'user', content: `<evidence>\n${evidence}\n</evidence>\n\n问题：${question}` }
    ];
    const completion = await chat({ messages, temperature: 0.3, maxTokens: 2000 });
    answer = completion.content;
  }

  // sediment (ADR-015 style): explicit request, or repeated quality question
  let sedimentStatus: 'archived' | 'sedimented' = 'archived';
  let sedimentChangeId: string | null = null;
  const shouldSediment =
    input.sediment === true ||
    ((await countSimilarQuestions(worldId, question)) >= 3 &&
      citations.length >= 2 &&
      answer.length >= 80 &&
      !/未找到足够依据/.test(answer));
  if (shouldSediment && citations.length >= 2) {
    const slugPart = question.slice(0, 40).replace(/[\\/:*?"<>|]+/g, '');
    const { change } = await (
      await import('@/lib/governance/changes')
    ).submitChange(worldId, {
      kind: 'entity_upsert',
      payload: {
        kind: 'concept',
        name: `问答：${slugPart}`,
        aliases: [],
        summary: answer.slice(0, 200),
        content: `**问**：${question}\n\n**答**：${answer}\n\n**引用**：${citations.map((c) => `${c.name}`).join('、')}`,
        confidence: 'INFERRED',
        tags: ['qa-sediment'],
        sourceRefs: []
      },
      author: 'assistant',
      batchId: undefined
    });
    sedimentStatus = 'sedimented';
    sedimentChangeId = change.id;
  }

  const record = await prisma.qaRecord.create({
    data: {
      worldId,
      question,
      answer,
      citations: citations as object[],
      retrieval: {
        mode: search.mode,
        hits: search.hits.length,
        rewritten,
        semantic: search.semantic
      } as object,
      sedimentStatus,
      sedimentChangeId
    }
  });

  return {
    qaId: record.id,
    question,
    answer,
    citations,
    retrieval: { mode: search.mode, hits: search.hits.length, rewritten, semantic: search.semantic }
  };
}

async function rewriteQuestion(
  question: string,
  chat: (request: {
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }) => Promise<ChatResult>
): Promise<string | null> {
  try {
    const completion = await chat({
      temperature: 0,
      maxTokens: 200,
      messages: [
        {
          role: 'system',
          content:
            '你是检索查询改写器。把创作者的问题改写成更适合世界观设定库检索的简洁查询：保留关键实体与术语，去掉口语。只输出改写后的查询。'
        },
        { role: 'user', content: question }
      ]
    });
    const rewritten = completion.content
      .trim()
      .replace(/^["']|["']$/g, '')
      .slice(0, 200);
    return rewritten || null;
  } catch {
    return null;
  }
}

function normalizeQuestionTokens(value: string) {
  return new Set(value.replace(/\s+/g, '').toLowerCase());
}

async function countSimilarQuestions(worldId: string, question: string): Promise<number> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await prisma.qaRecord.findMany({
    where: { worldId, createdAt: { gte: since } },
    select: { question: true }
  });
  const target = normalizeQuestionTokens(question);
  let count = 0;
  for (const row of rows) {
    const other = normalizeQuestionTokens(row.question);
    let shared = 0;
    for (const token of target) if (other.has(token)) shared += 1;
    const union = target.size + other.size - shared;
    if (union > 0 && shared / union >= 0.5) count += 1;
  }
  return count;
}

/** ISS-04：问答历史（世界知识助手的持久化记录）。 */
export async function listQaRecords(worldId: string, limit = 50) {
  const world = await prisma.world.findUnique({ where: { id: worldId } });
  if (!world) throw new Error(`World not found: ${worldId}`);
  return prisma.qaRecord.findMany({
    where: { worldId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, Math.max(1, limit))
  });
}
