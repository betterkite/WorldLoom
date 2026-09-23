import { z } from 'zod';

/**
 * Payload contracts for every Change kind. The same schemas validate API
 * input and merge-time payloads — the service layer is the staging authority.
 */

export const entityKindSchema = z.enum([
  'character',
  'location',
  'organization',
  'species',
  'item',
  'concept',
  'rule',
  'faction'
]);

export const confidenceSchema = z.enum(['EXTRACTED', 'INFERRED', 'AMBIGUOUS', 'UNVERIFIED']);

const llmCallMetaSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  profileId: z.string().min(1).max(120),
  model: z.string().min(1).max(200),
  latencyMs: z.number().int().nonnegative(),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative()
    })
    .nullable()
});

export const compileProvenanceSchema = z.object({
  runId: z.string().min(1).max(80),
  sourceUid: z.string().min(1).max(120),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  chunkIndexes: z.array(z.number().int().nonnegative()).min(1).max(100),
  chunkHashes: z
    .array(z.string().regex(/^[a-f0-9]{64}$/))
    .min(1)
    .max(100),
  sourceRanges: z
    .array(
      z.object({
        chunkIndex: z.number().int().nonnegative(),
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
        hash: z.string().regex(/^[a-f0-9]{64}$/)
      })
    )
    .min(1)
    .max(100),
  promptVersion: z.string().min(1).max(100),
  analysis: z.array(llmCallMetaSchema).min(1).max(100),
  generation: z.array(llmCallMetaSchema).min(1).max(100)
});

export const entityPayloadSchema = z.object({
  uid: z
    .string()
    .regex(/^ent_[0-9a-z]+$/)
    .optional(), // generated on create
  kind: entityKindSchema,
  name: z.string().min(1).max(120),
  aliases: z.array(z.string().min(1)).max(20).default([]),
  summary: z.string().max(2000).default(''),
  content: z.string().max(200_000).default(''),
  confidence: confidenceSchema.default('INFERRED'),
  tags: z.array(z.string().min(1)).max(20).default([]),
  sourceRefs: z.array(z.string()).max(50).default([])
});

export const epochPayloadSchema = z.object({
  uid: z
    .string()
    .regex(/^epo_[0-9a-z]+$/)
    .optional(),
  name: z.string().min(1).max(120),
  order: z.number().int().min(0).max(10_000),
  description: z.string().max(5000).default(''),
  startEventUid: z.string().nullable().default(null),
  endEventUid: z.string().nullable().default(null),
  sourceRefs: z.array(z.string().min(1)).max(50).default([])
});

export const fictionPrecisionSchema = z.enum(['year', 'month', 'day']);

export const eventPayloadSchema = z
  .object({
    uid: z
      .string()
      .regex(/^evt_[0-9a-z]+$/)
      .optional(),
    title: z.string().min(1).max(200),
    summary: z.string().max(2000).default(''),
    content: z.string().max(200_000).default(''),
    epochUid: z.string().nullable().default(null),
    epochYear: z.number().int().min(-100_000).max(100_000).nullable().default(null),
    epochMonth: z.number().int().min(1).max(99).nullable().default(null),
    epochDay: z.number().int().min(1).max(999).nullable().default(null),
    fictionPrecision: fictionPrecisionSchema.default('year'),
    locationUid: z.string().nullable().default(null),
    participantUids: z.array(z.string()).max(100).default([]),
    confidence: confidenceSchema.default('INFERRED'),
    causeUids: z.array(z.string()).max(50).default([]),
    effectUids: z.array(z.string()).max(50).default([]),
    sourceRefs: z.array(z.string().min(1)).max(50).default([])
  })
  .refine((data) => data.epochUid === null || data.epochYear !== null, {
    message: 'epochYear is required when epochUid is set'
  });

export const relationPayloadSchema = z.object({
  uid: z
    .string()
    .regex(/^rel_[0-9a-z]+$/)
    .optional(),
  eventUid: z.string().nullable().default(null),
  subjectUid: z.string().min(1),
  objectUid: z.string().min(1),
  relation: z.string().min(1).max(40),
  polarity: z
    .enum(['establish', 'strengthen', 'weaken', 'terminate'])
    .catch('establish')
    .default('establish'),
  note: z.string().max(2000).default(''),
  sourceRefs: z.array(z.string().min(1)).max(50).default([])
});

export const changeKindSchema = z.enum([
  'entity_upsert',
  'entity_delete',
  'event_upsert',
  'event_delete',
  'epoch_upsert',
  'epoch_delete',
  'relation_upsert',
  'relation_delete'
]);

export const submitChangeSchema = z.object({
  kind: changeKindSchema,
  targetUid: z.string().optional(),
  payload: z.unknown().optional(),
  author: z.string().min(1).max(80).default('local-user'),
  batchId: z.string().optional(),
  provenance: compileProvenanceSchema.optional()
});

export const updateChangeSchema = z.object({
  payload: z.unknown().optional(),
  author: z.string().min(1).max(80).optional(),
  expectedRevision: z.number().int().optional()
});

/** Derive the global sort key from epoch order + in-epoch year (+ month). */
export function deriveSortOrder(
  epochOrder: number | null,
  epochYear: number | null,
  precision: string
): number {
  const epoch = epochOrder ?? 0;
  const year = epochYear ?? 0;
  const month = precision === 'day' || precision === 'month' ? 12 : 0;
  return epoch * 1_000_000 + (year + 100_000) * 100 + month;
}
