import { prisma } from '@/lib/db/client';
import type { Prisma, ChangeKind } from '@prisma/client';
import { GovernanceError, requireWorld } from './changes';
import { deriveSortOrder } from './schemas';

/**
 * Merge engine for immutable world versions and audited changes.
 *
 * Contract:
 *  - Versions are immutable. A merge copies ALL content rows from the source
 *    version into `next = masterVersion + 1`, then applies pending Changes in
 *    submission order (createdAt, rowid).
 *  - Conflicts are recorded, never blocking: latest submitted wins.
 *      - concurrent_target: two pending changes touch the same target uid
 *        (identical-payload re-submissions are deduplicated silently —
 *        multi-chapter mentions of the same entity are the norm)
 *      - stale_base_version: change.baseVersion !== master at merge time
 *  - Deletes leave tombstones for audit; a later upsert of the same uid
 *    removes the tombstone.
 *  - Rollback is a merge variant that copies an older version forward,
 *    preserving monotonic, append-only history.
 */

type Tx = Prisma.TransactionClient;

interface ApplyContext {
  tx: Tx;
  worldId: string;
  nextVersion: number;
}

async function copyVersionRows(tx: Tx, worldId: string, from: number, to: number) {
  const [epochs, entities, events, edges, relations] = await Promise.all([
    tx.epoch.findMany({ where: { worldId, version: from } }),
    tx.entity.findMany({ where: { worldId, version: from } }),
    tx.chronicleEvent.findMany({ where: { worldId, version: from } }),
    tx.eventEdge.findMany({ where: { worldId, version: from } }),
    tx.relationshipEvent.findMany({ where: { worldId, version: from } })
  ]);

  const strip = <T extends { id: string }>(row: T) => {
    const { id: _id, ...rest } = row;
    return { ...rest, version: to };
  };

  await tx.epoch.createMany({ data: epochs.map(strip) });
  await tx.entity.createMany({ data: entities.map(strip) });
  await tx.chronicleEvent.createMany({ data: events.map(strip) });
  await tx.eventEdge.createMany({ data: edges.map(strip) });
  await tx.relationshipEvent.createMany({ data: relations.map(strip) });
}

// ------------------------------------------------------------------
// Apply one change onto the next version
// ------------------------------------------------------------------

async function applyUpsert(
  ctx: ApplyContext,
  kind: ChangeKind,
  uid: string,
  payload: Prisma.JsonValue
) {
  const { tx, worldId, nextVersion } = ctx;
  const data = payload as Record<string, unknown>;

  if (kind === 'entity_upsert') {
    const existing = await tx.entity.findUnique({
      where: { worldId_version_uid: { worldId, version: nextVersion, uid } }
    });
    const row = {
      kind: data.kind as never,
      name: data.name as string,
      aliases: (data.aliases ?? []) as string[],
      summary: (data.summary ?? '') as string,
      content: (data.content ?? '') as string,
      confidence: (data.confidence ?? 'INFERRED') as never,
      tags: (data.tags ?? []) as string[],
      sourceRefs: (data.sourceRefs ?? []) as string[]
    };
    if (existing) await tx.entity.update({ where: { id: existing.id }, data: row });
    else await tx.entity.create({ data: { worldId, version: nextVersion, uid, ...row } });
    await tx.tombstone.deleteMany({ where: { worldId, uid } });
    return;
  }

  if (kind === 'epoch_upsert') {
    const existing = await tx.epoch.findUnique({
      where: { worldId_version_uid: { worldId, version: nextVersion, uid } }
    });
    const row = {
      name: data.name as string,
      order: data.order as number,
      description: (data.description ?? '') as string,
      startEventUid: (data.startEventUid ?? null) as string | null,
      endEventUid: (data.endEventUid ?? null) as string | null,
      sourceRefs: (data.sourceRefs ?? []) as string[]
    };
    if (existing) await tx.epoch.update({ where: { id: existing.id }, data: row });
    else await tx.epoch.create({ data: { worldId, version: nextVersion, uid, ...row } });
    await tx.tombstone.deleteMany({ where: { worldId, uid } });
    return;
  }

  if (kind === 'event_upsert') {
    const epochUid = (data.epochUid ?? null) as string | null;
    const epochYear = (data.epochYear ?? null) as number | null;
    const precision = (data.fictionPrecision ?? 'year') as string;
    let epochOrder: number | null = null;
    if (epochUid) {
      const epoch = await tx.epoch.findUnique({
        where: { worldId_version_uid: { worldId, version: nextVersion, uid: epochUid } }
      });
      if (!epoch)
        throw new GovernanceError(
          'unknown_epoch',
          `Event ${uid} references unknown epoch ${epochUid}`
        );
      epochOrder = epoch.order;
    }
    const row = {
      title: data.title as string,
      summary: (data.summary ?? '') as string,
      content: (data.content ?? '') as string,
      epochUid,
      epochYear,
      epochMonth: (data.epochMonth ?? null) as number | null,
      epochDay: (data.epochDay ?? null) as number | null,
      fictionPrecision: precision,
      sortOrder: deriveSortOrder(epochOrder, epochYear, precision),
      locationUid: (data.locationUid ?? null) as string | null,
      participantUids: (data.participantUids ?? []) as string[],
      confidence: (data.confidence ?? 'INFERRED') as never,
      sourceRefs: (data.sourceRefs ?? []) as string[]
    };
    const existing = await tx.chronicleEvent.findUnique({
      where: { worldId_version_uid: { worldId, version: nextVersion, uid } }
    });
    if (existing) await tx.chronicleEvent.update({ where: { id: existing.id }, data: row });
    else await tx.chronicleEvent.create({ data: { worldId, version: nextVersion, uid, ...row } });
    await tx.tombstone.deleteMany({ where: { worldId, uid } });

    // Rebuild causal edges for this event (cause = others → this, effect = this → others).
    await tx.eventEdge.deleteMany({
      where: { worldId, version: nextVersion, OR: [{ causeUid: uid }, { effectUid: uid }] }
    });
    const causeUids = ((data.causeUids ?? []) as string[]).filter((c) => c !== uid);
    const effectUids = ((data.effectUids ?? []) as string[]).filter((e) => e !== uid);
    if (causeUids.length + effectUids.length > 0) {
      await tx.eventEdge.createMany({
        data: [
          ...causeUids.map((causeUid) => ({
            worldId,
            version: nextVersion,
            causeUid,
            effectUid: uid
          })),
          ...effectUids.map((effectUid) => ({
            worldId,
            version: nextVersion,
            causeUid: uid,
            effectUid
          }))
        ],
        skipDuplicates: true
      });
    }
    return;
  }

  if (kind === 'relation_upsert') {
    const existing = await tx.relationshipEvent.findUnique({
      where: { worldId_version_uid: { worldId, version: nextVersion, uid } }
    });
    const row = {
      eventUid: (data.eventUid ?? null) as string | null,
      subjectUid: data.subjectUid as string,
      objectUid: data.objectUid as string,
      relation: data.relation as string,
      polarity: (data.polarity ?? 'establish') as string,
      note: (data.note ?? '') as string,
      sourceRefs: (data.sourceRefs ?? []) as string[]
    };
    if (existing) await tx.relationshipEvent.update({ where: { id: existing.id }, data: row });
    else
      await tx.relationshipEvent.create({ data: { worldId, version: nextVersion, uid, ...row } });
    await tx.tombstone.deleteMany({ where: { worldId, uid } });
  }
}

async function applyDelete(
  ctx: ApplyContext,
  kind: ChangeKind,
  uid: string,
  changeId: string,
  author: string
) {
  const { tx, worldId, nextVersion } = ctx;

  if (kind === 'entity_delete') {
    await tx.entity.deleteMany({ where: { worldId, version: nextVersion, uid } });
  } else if (kind === 'event_delete') {
    await tx.chronicleEvent.deleteMany({ where: { worldId, version: nextVersion, uid } });
    await tx.eventEdge.deleteMany({
      where: { worldId, version: nextVersion, OR: [{ causeUid: uid }, { effectUid: uid }] }
    });
  } else if (kind === 'epoch_delete') {
    await tx.epoch.deleteMany({ where: { worldId, version: nextVersion, uid } });
  } else if (kind === 'relation_delete') {
    await tx.relationshipEvent.deleteMany({ where: { worldId, version: nextVersion, uid } });
  }
  await tx.tombstone.create({
    data: { worldId, uid, kind, deletedAtVersion: nextVersion, changeId, author }
  });
}

// ------------------------------------------------------------------
// Merge / rollback
// ------------------------------------------------------------------

/**
 * Deterministic, order-insensitive serialization used to detect identical
 * re-submissions (e.g. the same entity compiled from multiple chapters).
 */
function stableKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableKey(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined
  );
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableKey(v)}`).join(',')}}`;
}

interface MergeOptions {
  summary?: string;
  /** Copy content from this version instead of the current master (rollback). */
  rollbackTo?: number;
}

export async function mergeWorld(worldId: string, options: MergeOptions | string = {}) {
  const opts = typeof options === 'string' ? { summary: options } : options;
  await requireWorld(worldId);

  if (opts.rollbackTo !== undefined) {
    const target = await prisma.worldVersion.findUnique({
      where: { worldId_version: { worldId, version: opts.rollbackTo } }
    });
    if (!target)
      throw new GovernanceError('version_not_found', `Version ${opts.rollbackTo} not found`);
  }

  const result = await prisma.$transaction(async (tx) => {
    // ISS-21: per-world advisory lock + state re-read INSIDE the transaction.
    // A second concurrent merge now sees the post-commit state (no pending
    // changes → nothing_to_merge / 409) instead of both writing the same
    // next version and colliding on the unique constraint (500).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${worldId}))`;
    const world = await tx.world.findUniqueOrThrow({ where: { id: worldId } });
    const changes = await tx.change.findMany({
      where: { worldId, status: 'pending' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    const isRollback = opts.rollbackTo !== undefined;
    if (changes.length === 0 && !isRollback) {
      throw new GovernanceError('nothing_to_merge', 'There are no pending changes');
    }
    const sourceVersion = opts.rollbackTo ?? world.masterVersion;
    const nextVersion = world.masterVersion + 1;
    await copyVersionRows(tx, worldId, sourceVersion, nextVersion);

    const seen = new Map<string, string>(); // `${kind}:${uid}` -> changeId
    const seenPayload = new Map<string, unknown>(); // `${kind}:${uid}` -> last payload
    let conflicts = 0;
    const ctx: ApplyContext = { tx, worldId, nextVersion };

    for (const change of changes) {
      const uid = change.targetUid as string;
      const key = `${change.kind}:${uid}`;
      // identical re-submission of an already-applied target: deduplicate
      // silently instead of flagging a conflict
      const duplicate =
        seen.has(key) && stableKey(seenPayload.get(key)) === stableKey(change.payload);
      const concurrent = seen.has(key) && !duplicate;
      const stale = !isRollback && change.baseVersion !== world.masterVersion;
      const conflict = concurrent || stale;

      if (conflict) {
        conflicts += 1;
        await tx.conflictRecord.create({
          data: {
            worldId,
            version: nextVersion,
            kind: change.kind,
            targetUid: uid,
            changeId: change.id,
            earlierChangeId: concurrent ? (seen.get(key) ?? null) : null,
            reason: concurrent ? 'concurrent_target' : 'stale_base_version'
          }
        });
      }
      seen.set(key, change.id);
      seenPayload.set(key, change.payload);

      if (duplicate) {
        // content already applied — keep merged without re-applying
        await tx.change.update({
          where: { id: change.id },
          data: { status: 'merged', mergedVersion: nextVersion, conflict }
        });
        continue;
      }

      if (change.kind.endsWith('_upsert')) {
        await applyUpsert(ctx, change.kind, uid, change.payload);
      } else {
        await applyDelete(ctx, change.kind, uid, change.id, change.author);
      }
      await tx.change.update({
        where: { id: change.id },
        data: { status: 'merged', mergedVersion: nextVersion, conflict }
      });
    }

    await tx.worldVersion.create({
      data: {
        worldId,
        version: nextVersion,
        parentVersion: world.masterVersion,
        summary: opts.summary ?? (isRollback ? `Rollback to v${sourceVersion}` : 'Manual merge'),
        changeCount: changes.length,
        conflictCount: conflicts
      }
    });

    await tx.world.update({
      where: { id: worldId },
      data: { masterVersion: nextVersion, updatedAt: new Date() }
    });

    return {
      version: nextVersion,
      parentVersion: world.masterVersion,
      changeCount: changes.length,
      conflictCount: conflicts
    };
  });

  // A merge creates a new immutable retrieval target. Queue the refresh after
  // commit so indexing can never participate in or delay the governance txn.
  const { enqueueSemanticIndex, runSemanticIndexJob } = await import('@/lib/retrieval/search');
  const semanticJob = await enqueueSemanticIndex(worldId, result.version);
  if (semanticJob && semanticJob.status !== 'completed' && process.env.NODE_ENV !== 'test') {
    void runSemanticIndexJob(semanticJob.id);
  }

  return { ...result, semanticIndexJobId: semanticJob?.id ?? null };
}

/** Read-side helper: resolve a world's master version (throws when missing). */
export async function getMasterVersion(worldId: string): Promise<number> {
  const world = await requireWorld(worldId);
  return world.masterVersion;
}
