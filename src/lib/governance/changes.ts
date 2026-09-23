import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db/client';
import { newUid } from '@/lib/uid';
import {
  changeKindSchema,
  compileProvenanceSchema,
  entityPayloadSchema,
  epochPayloadSchema,
  eventPayloadSchema,
  relationPayloadSchema,
  submitChangeSchema,
  updateChangeSchema,
  deriveSortOrder
} from './schemas';
import { z } from 'zod';

/**
 * Change staging service (governance audit chain).
 * Every mutation of the canon enters as a pending Change; merge is the only
 * path that turns Changes into a new immutable WorldVersion.
 */

export class GovernanceError extends Error {
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'GovernanceError';
    this.code = code;
    this.details = details;
  }
}

const payloadSchemas: Record<string, z.ZodTypeAny> = {
  entity_upsert: entityPayloadSchema,
  epoch_upsert: epochPayloadSchema,
  event_upsert: eventPayloadSchema,
  relation_upsert: relationPayloadSchema
};

function validatePayload(kind: string, payload: unknown) {
  const schema = payloadSchemas[kind];
  if (schema) {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new GovernanceError(
        'invalid_payload',
        `Payload for ${kind} is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        parsed.error.issues
      );
    }
    return parsed.data;
  }
  return payload; // delete kinds carry no payload
}

/** Stable JSON comparison used for retry-safe compiler batches. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function ensureTarget(kind: string, targetUid: string | undefined): string {
  if (!targetUid) {
    throw new GovernanceError('invalid_change', `${kind} requires targetUid`);
  }
  return targetUid;
}

export async function submitChange(worldId: string, input: unknown) {
  const parsed = submitChangeSchema.safeParse(input);
  if (!parsed.success) {
    throw new GovernanceError(
      'invalid_change',
      `Change request is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
    );
  }
  const { kind, targetUid, author, batchId, provenance } = parsed.data;

  const world = await prisma.world.findUnique({ where: { id: worldId } });
  if (!world) throw new GovernanceError('world_not_found', 'World not found');

  const validated = validatePayload(kind, parsed.data.payload);

  // A durable compiler retry reuses its batchId. Return the original pending
  // change when the same payload was already staged, so a crash during staging
  // cannot duplicate a partially-created batch.
  if (batchId) {
    const existingBatch = await prisma.change.findMany({
      where: { worldId, kind, batchId, status: 'pending' }
    });
    const duplicate = existingBatch.find(
      (candidate) => canonicalJson(candidate.payload) === canonicalJson(validated ?? {})
    );
    if (duplicate) return { change: duplicate, merged: null };
  }

  // Creates need a uid (payload-supplied or generated); updates/deletes need an explicit target.
  let uid: string | null;
  if (kind.endsWith('_upsert')) {
    const payloadUid = (validated as { uid?: string }).uid;
    const prefix = kind.startsWith('entity')
      ? 'ent'
      : kind.startsWith('event')
        ? 'evt'
        : kind.startsWith('epoch')
          ? 'epo'
          : 'rel';
    uid = targetUid ?? payloadUid ?? newUid(prefix);
  } else {
    uid = ensureTarget(kind, targetUid);
  }

  const change = await prisma.change.create({
    data: {
      worldId,
      kind,
      targetUid: uid,
      payload: validated === undefined ? {} : (validated as object),
      candidatePayload: validated === undefined ? {} : (validated as object),
      author,
      batchId: batchId ?? null,
      provenance: provenance ?? undefined,
      baseVersion: world.masterVersion,
      status: 'pending'
    }
  });

  const pendingCount = await prisma.change.count({ where: { worldId, status: 'pending' } });
  let merged = null;
  if (world.ingestMode === 'auto' && pendingCount >= 3) {
    const { mergeWorld } = await import('./merge');
    merged = await mergeWorld(worldId, `Automatic batch merge (${pendingCount} changes)`);
  }

  return { change, merged };
}

export async function listChanges(worldId: string, status: 'pending' | 'merged' | null = null) {
  await requireWorld(worldId);
  return prisma.change.findMany({
    where: { worldId, ...(status ? { status } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 200
  });
}

export async function updatePendingChange(worldId: string, changeId: string, input: unknown) {
  const parsed = updateChangeSchema.safeParse(input);
  if (!parsed.success) throw new GovernanceError('invalid_change', 'Update request is invalid');

  const change = await prisma.change.findUnique({ where: { id: changeId } });
  if (!change || change.worldId !== worldId)
    throw new GovernanceError('change_not_found', 'Change not found');
  if (change.status !== 'pending') {
    throw new GovernanceError('change_immutable', 'Merged changes are immutable');
  }
  if (
    parsed.data.expectedRevision !== undefined &&
    parsed.data.expectedRevision !== change.revision
  ) {
    throw new GovernanceError('revision_conflict', 'The change was modified by another editor', {
      expectedRevision: parsed.data.expectedRevision,
      currentRevision: change.revision
    });
  }

  const kind = changeKindSchema.parse(change.kind);
  const payload =
    parsed.data.payload !== undefined ? validatePayload(kind, parsed.data.payload) : change.payload;

  return prisma.change.update({
    where: { id: changeId },
    data: {
      payload: payload as object,
      revision: change.revision + 1,
      author: parsed.data.author ?? change.author,
      baseVersion: change.baseVersion
    }
  });
}

export async function deletePendingChange(worldId: string, changeId: string) {
  const change = await prisma.change.findUnique({ where: { id: changeId } });
  if (!change || change.worldId !== worldId)
    throw new GovernanceError('change_not_found', 'Change not found');
  if (change.status !== 'pending') {
    throw new GovernanceError('change_immutable', 'Merged changes are immutable');
  }
  await prisma.change.delete({ where: { id: changeId } });
  return { id: changeId, deleted: true };
}

export async function requireWorld(worldId: string) {
  const world = await prisma.world.findUnique({ where: { id: worldId } });
  if (!world) throw new GovernanceError('world_not_found', 'World not found');
  return world;
}

export { deriveSortOrder };

/** ISS-17 审阅可读化：把裸 uid 换成条目名/事件标题，并标注所属批次。 */
const MAX_SOURCE_EVIDENCE_CHARS = 6_000;
const MAX_SOURCE_EVIDENCE_EXCERPT = 2_000;

function sourceEvidenceFor(
  provenanceValue: unknown,
  sources: Map<string, { uid: string; filename: string; content: string }>
) {
  const parsed = compileProvenanceSchema.safeParse(provenanceValue);
  if (!parsed.success) return [];
  const source = sources.get(parsed.data.sourceUid);
  if (!source) return [];
  const sourceHashMatches =
    createHash('sha256').update(source.content).digest('hex') === parsed.data.sourceHash;
  let remaining = MAX_SOURCE_EVIDENCE_CHARS;
  return parsed.data.sourceRanges.flatMap((range) => {
    if (remaining <= 0 || range.start >= range.end || range.end > source.content.length) return [];
    const text = source.content.slice(range.start, range.end);
    const excerpt = text.slice(0, Math.min(text.length, MAX_SOURCE_EVIDENCE_EXCERPT, remaining));
    remaining -= excerpt.length;
    return [
      {
        sourceUid: source.uid,
        filename: source.filename,
        start: range.start,
        end: range.end,
        excerpt,
        truncated: excerpt.length < text.length,
        hashMatches: createHash('sha256').update(text).digest('hex') === range.hash,
        sourceHashMatches
      }
    ];
  });
}

export async function listChangesDetailed(
  worldId: string,
  status: 'pending' | 'merged' | null = 'pending'
) {
  await requireWorld(worldId);
  const world = await prisma.world.findUniqueOrThrow({ where: { id: worldId } });
  const changes = await prisma.change.findMany({
    where: { worldId, ...(status ? { status } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 300
  });
  const sourceUids = changes.flatMap((change) => {
    const parsed = compileProvenanceSchema.safeParse(change.provenance);
    return parsed.success ? [parsed.data.sourceUid] : [];
  });
  const [entities, events, sourceRows] = await Promise.all([
    prisma.entity.findMany({
      where: { worldId, version: world.masterVersion },
      select: { uid: true, name: true, kind: true }
    }),
    prisma.chronicleEvent.findMany({
      where: { worldId, version: world.masterVersion },
      select: { uid: true, title: true }
    }),
    prisma.source.findMany({
      where: { worldId, uid: { in: sourceUids } },
      select: { uid: true, filename: true, content: true }
    })
  ]);
  const sources = new Map(sourceRows.map((source) => [source.uid, source]));
  const entityName = new Map(entities.map((e) => [e.uid, e.name]));
  const eventTitle = new Map(events.map((e) => [e.uid, e.title]));
  const nameOf = (uid: string | null) =>
    uid ? (entityName.get(uid) ?? eventTitle.get(uid) ?? null) : null;

  return changes.map((change) => {
    const payload = (change.payload ?? {}) as Record<string, unknown>;
    const display =
      String(payload.name ?? payload.title ?? '') ||
      nameOf(change.targetUid) ||
      (payload.subjectUid
        ? `${nameOf(String(payload.subjectUid)) ?? '?'} —${String(payload.relation ?? '')}→ ${nameOf(String(payload.objectUid)) ?? '?'}`
        : '') ||
      change.targetUid ||
      '（新增）';
    return {
      id: change.id,
      kind: change.kind,
      status: change.status,
      author: change.author,
      batchId: change.batchId,
      targetUid: change.targetUid,
      display,
      summary: String(payload.summary ?? payload.description ?? '').slice(0, 160),
      payload: change.payload,
      candidatePayload: change.candidatePayload,
      conflict: change.conflict,
      mergedVersion: change.mergedVersion,
      provenance: change.provenance,
      sourceEvidence: sourceEvidenceFor(change.provenance, sources),
      createdAt: change.createdAt
    };
  });
}
