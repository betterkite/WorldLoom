import type { z } from 'zod';
import type { ChatMessage, ChatResult } from '@/lib/llm/client';
import {
  extractJson,
  genesisPlanSchema,
  generatedWorldSchema,
  type GenesisPlan,
  type GeneratedWorld
} from './contracts';
import {
  buildAnalysisMessages,
  buildGenerationMessages,
  buildGenesisCommitMessages,
  buildPlanMessages
} from './prompts';
import { withLlmUsageBudget } from '@/lib/llm/usage-budget';

/** Chat injection seam: the real client in production, fakes in tests. */
export type ChatFn = (request: {
  profileId?: string | null;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}) => Promise<ChatResult>;

function parseLlmJson<T>(result: ChatResult, schema: z.ZodType<T>, what: string): T {
  let raw: unknown;
  try {
    raw = extractJson(result.content);
  } catch {
    // salvage: 截断的 JSON → 自动补齐引号和括号
    let text = result.content.trim();
    // 剥掉 markdown 代码块
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) text = fenceMatch[1].trim();
    // 找到第一个 { 或 [
    const start = text.indexOf('{') >= 0 ? text.indexOf('{') : text.indexOf('[');
    if (start < 0) throw new Error(`${what}: LLM returned no JSON`);
    text = text.slice(start);
    // 只移除末尾悬空的逗号（不做贪婪匹配以免误删有效字段）
    // 统计未闭合的括号并补齐
    let braces = 0,
      brackets = 0,
      inStr = false,
      esc = false;
    for (const ch of text) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === '[') brackets++;
      else if (ch === ']') brackets--;
    }
    if (inStr) text += '"';
    text += ']'.repeat(Math.max(0, brackets));
    text += '}'.repeat(Math.max(0, braces));
    try {
      raw = JSON.parse(text);
    } catch (salvageError) {
      throw new Error(
        `${what}: LLM returned invalid JSON (salvage failed: ${(salvageError as Error).message})`,
        { cause: salvageError }
      );
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `${what}: schema mismatch — ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')
        .slice(0, 300)}`
    );
  }
  return parsed.data;
}

// ------------------------------------------------------------------
// Genesis wizard (创世向导)
// ------------------------------------------------------------------

/** Step 1: premise → framework preview. Pure computation, nothing staged. */
export async function planWorld(
  chat: ChatFn,
  input: { name: string; premise: string; style: string }
): Promise<GenesisPlan> {
  const messages = buildPlanMessages(input);
  const result = await withLlmUsageBudget(
    chat,
    'genesis planning'
  )({
    messages,
    temperature: 0.7,
    maxTokens: 8000
  });
  return parseLlmJson(result, genesisPlanSchema, 'genesis plan');
}

/** Step 2: approved framework → full world content → pending Changes (batch). */
export async function commitGenesis(
  chat: ChatFn,
  worldId: string,
  input: { name: string; premise: string; style: string },
  plan: unknown
): Promise<{
  staged: number;
  defects: { kind: string; name: string; reason: string }[];
  batchId: string;
}> {
  const { stageGeneratedWorld } = await import('./stager');
  const messages = buildGenesisCommitMessages(input, plan);
  const result = await withLlmUsageBudget(
    chat,
    'genesis commit'
  )({
    messages,
    temperature: 0.5,
    maxTokens: 8000
  });
  const generated = parseLlmJson(
    result,
    generatedWorldSchema,
    'genesis generation'
  ) as GeneratedWorld;
  const staged = await stageGeneratedWorld(worldId, generated, { author: 'genesis' });
  return { staged: staged.staged, defects: staged.defects, batchId: staged.batchId };
}

// ------------------------------------------------------------------
// Source compiler (two-step: analysis → generation)
// ------------------------------------------------------------------

export interface CompileContext {
  worldName: string;
  premise: string;
  style: string;
  catalog: {
    epochs: { uid: string; name: string }[];
    entities: { uid: string; name: string; kind: string }[];
    events: { uid: string; title: string }[];
  };
  sourceFilename: string;
  sourceContent: string;
}

export const COMPILE_PROMPT_VERSION = 'compile-v1';

export type CompileCallMeta = {
  profileId: string;
  model: string;
  latencyMs: number;
  usage: ChatResult['usage'];
};

function compileCallMeta(result: ChatResult): CompileCallMeta {
  return {
    profileId: result.profileId,
    model: result.model,
    latencyMs: result.latencyMs,
    usage: result.usage
  };
}

/**
 * 编译分块上限。较小的块可以显著降低生成 JSON 被截断的概率；
 * 每个块独立编译，最后再按名称去重合并。
 */
export const COMPILE_CHUNK_LIMIT = 1_000;

/** 按句末边界切成小块，任何字符都不能在切分过程中丢失。 */
export function splitForCompile(content: string, limit = COMPILE_CHUNK_LIMIT): string[] {
  if (content.length <= limit) return [content];
  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);
    const sentenceEnd = Math.max(
      window.lastIndexOf('。'),
      window.lastIndexOf('！'),
      window.lastIndexOf('？'),
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('\n')
    );
    const cut = sentenceEnd > limit / 2 ? sentenceEnd + 1 : limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

export function mergeAnalyses(analyses: unknown[]): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const analysis of analyses) {
    if (!analysis || typeof analysis !== 'object') continue;
    for (const [key, value] of Object.entries(analysis as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const bucket = merged[key] ?? [];
      for (const item of value) {
        const text = String(item);
        if (!bucket.includes(text)) bucket.push(text);
      }
      merged[key] = bucket;
    }
  }
  return merged;
}

export function mergeGeneratedWorlds(worlds: GeneratedWorld[]): GeneratedWorld {
  const epochs = new Map<string, GeneratedWorld['epochs'][number]>();
  const entities = new Map<string, GeneratedWorld['entities'][number]>();
  const events = new Map<string, GeneratedWorld['events'][number]>();
  const relations = new Map<string, GeneratedWorld['relations'][number]>();
  for (const world of worlds) {
    for (const epoch of world.epochs) if (!epochs.has(epoch.name)) epochs.set(epoch.name, epoch);
    for (const entity of world.entities) {
      const key = entity.name.replace(/\s+/g, '').toLowerCase();
      const existing = entities.get(key);
      // 同名条目：保留内容更丰富的一份
      if (!existing || entity.content.length > existing.content.length) entities.set(key, entity);
    }
    for (const event of world.events) {
      const key = event.title.replace(/\s+/g, '').toLowerCase();
      const existing = events.get(key);
      if (!existing || event.content.length > existing.content.length) events.set(key, event);
    }
    for (const relation of world.relations) {
      relations.set(`${relation.subject}|${relation.object}|${relation.relation}`, relation);
    }
  }
  return {
    epochs: [...epochs.values()],
    entities: [...entities.values()],
    events: [...events.values()],
    relations: [...relations.values()]
  };
}

/** Run the analysis half for one durable compiler chunk. */
export async function analyzeCompileChunkWithMeta(
  chat: ChatFn,
  context: CompileContext,
  sourceContent: string
): Promise<{ analysis: unknown; meta: CompileCallMeta }> {
  const result = await chat({
    messages: buildAnalysisMessages({ ...context, sourceContent }),
    temperature: 0.3,
    maxTokens: 8000
  });
  return { analysis: extractJson(result.content), meta: compileCallMeta(result) };
}

/** Run the generation half for one durable compiler chunk. */
export async function generateCompileChunkWithMeta(
  chat: ChatFn,
  context: CompileContext,
  sourceContent: string,
  analysis: unknown
): Promise<{ generated: GeneratedWorld; meta: CompileCallMeta }> {
  const result = await chat({
    messages: buildGenerationMessages({ ...context, sourceContent }, analysis),
    temperature: 0.4,
    maxTokens: 8000
  });
  return {
    generated: parseLlmJson(result, generatedWorldSchema, 'source compilation'),
    meta: compileCallMeta(result)
  };
}
