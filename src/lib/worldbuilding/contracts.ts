import { z } from 'zod';

/**
 * Contracts the LLM must honour when returning JSON. These are intentionally
 * name-based (not uid-based): the LLM references epochs/entities/events by
 * their Chinese names, and the Node stager resolves every name to a stable
 * uid (existing master row or newly generated). Node is the staging authority.
 */

export const generatedEpochSchema = z.object({
  name: z.string().min(1).max(60),
  order: z.number().int().min(0).max(999),
  description: z.string().max(2000).default('')
});

export const generatedEntitySchema = z.object({
  kind: z.enum([
    'character',
    'location',
    'organization',
    'species',
    'item',
    'concept',
    'rule',
    'faction'
  ]),
  name: z.string().min(1).max(60),
  aliases: z.array(z.string().max(40)).max(10).default([]),
  summary: z.string().max(500).default(''),
  content: z.string().max(8000).default(''),
  confidence: z.enum(['EXTRACTED', 'INFERRED', 'AMBIGUOUS', 'UNVERIFIED']).default('INFERRED'),
  tags: z.array(z.string().max(20)).max(8).default([])
});

export const generatedEventSchema = z.object({
  title: z.string().min(1).max(80),
  summary: z.string().max(500).default(''),
  content: z.string().max(8000).default(''),
  epochName: z.string().min(1).max(60),
  year: z.number().int().min(-100_000).max(100_000).nullable().catch(null).default(null),
  participants: z.array(z.string().max(60)).max(10).default([]),
  location: z.string().max(60).nullable().default(null),
  causes: z.array(z.string().max(80)).max(10).default([]),
  confidence: z.enum(['EXTRACTED', 'INFERRED', 'AMBIGUOUS', 'UNVERIFIED']).default('INFERRED')
});

// 关系名允许自由文本（中文如「师徒」「宿敌」是合法创作表达），polarity 不认识时回落 establish
export const generatedRelationSchema = z.object({
  subject: z.string().min(1).max(60),
  object: z.string().min(1).max(60),
  relation: z.string().min(1).max(40),
  polarity: z
    .enum(['establish', 'strengthen', 'weaken', 'terminate'])
    .catch('establish')
    .default('establish'),
  eventName: z.string().max(80).nullable().default(null)
});

export const generatedWorldSchema = z.object({
  epochs: z.array(generatedEpochSchema).max(10).default([]),
  entities: z.array(generatedEntitySchema).max(40).default([]),
  events: z.array(generatedEventSchema).max(50).default([]),
  relations: z.array(generatedRelationSchema).max(80).default([])
});

export type GeneratedWorld = z.infer<typeof generatedWorldSchema>;
export type GeneratedEntity = z.infer<typeof generatedEntitySchema>;
export type GeneratedEvent = z.infer<typeof generatedEventSchema>;
export type GeneratedEpoch = z.infer<typeof generatedEpochSchema>;
export type GeneratedRelation = z.infer<typeof generatedRelationSchema>;

/** Genesis plan (step 1): a lightweight framework preview — never staged. */
export const genesisPlanSchema = z.object({
  premiseExpanded: z.string().max(3000).default(''),
  tone: z.string().max(500).default(''),
  epochs: z
    .array(z.object({ name: z.string().max(60), description: z.string().max(500).default('') }))
    .max(6)
    .default([]),
  factions: z
    .array(z.object({ name: z.string().max(60), summary: z.string().max(300).default('') }))
    .max(8)
    .default([]),
  regions: z
    .array(z.object({ name: z.string().max(60), summary: z.string().max(300).default('') }))
    .max(8)
    .default([]),
  threads: z.array(z.string().max(200)).max(8).default([])
});

export type GenesisPlan = z.infer<typeof genesisPlanSchema>;

/** Tolerant JSON extraction for model/compiler responses. */
export function extractJson(text: string): unknown {
  let cleaned = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .trim();
  cleaned = cleaned
    .replace(/^```(?:json|JSON)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fallthrough */
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      /* fallthrough */
    }
  }
  throw new Error(
    `LLM returned invalid JSON (received: ${cleaned.replace(/\s+/g, ' ').slice(0, 160) || '<empty>'})`
  );
}
