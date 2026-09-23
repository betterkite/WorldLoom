import { prisma } from '@/lib/db/client';
import { submitChange, GovernanceError } from '@/lib/governance/changes';
import type { GeneratedWorld } from './contracts';

/**
 * The staging authority for the WorldLoom compiler contract.
 *
 * Takes LLM-generated world content (name-referenced) and turns it into
 * pending Changes on the governance chain:
 *  1. epochs first (name → fresh uid), then entities, then events, then
 *     relations — later stages resolve references through earlier maps.
 *  2. Name resolution prefers EXISTING master rows (updates) over creating
 *     duplicates; unresolvable references are recorded as defects and skipped.
 *  3. Every staged change shares one batchId for review UX.
 */

export interface StageResult {
  batchId: string;
  staged: number;
  defects: { kind: string; name: string; reason: string }[];
  uidMap: {
    epochs: Record<string, string>;
    entities: Record<string, string>;
    events: Record<string, string>;
  };
}

export type CompileProvenance = {
  runId: string;
  sourceUid: string;
  sourceHash: string;
  chunkIndexes: number[];
  chunkHashes: string[];
  sourceRanges: { chunkIndex: number; start: number; end: number; hash: string }[];
  promptVersion: string;
  analysis: {
    chunkIndex: number;
    profileId: string;
    model: string;
    latencyMs: number;
    usage: { inputTokens: number; outputTokens: number } | null;
  }[];
  generation: {
    chunkIndex: number;
    profileId: string;
    model: string;
    latencyMs: number;
    usage: { inputTokens: number; outputTokens: number } | null;
  }[];
};

type ProvenanceKind = 'epoch' | 'entity' | 'event' | 'relation';

const NAME_KEY = (name: string) => name.replace(/\s+/g, '').toLowerCase();

export async function stageGeneratedWorld(
  worldId: string,
  generated: GeneratedWorld,
  options: {
    author?: string;
    batchId?: string;
    sourceRefs?: string[];
    provenanceFor?: (kind: ProvenanceKind, name: string) => CompileProvenance | undefined;
  } = {}
): Promise<StageResult> {
  const author = options.author ?? 'world-compiler';
  const batchId =
    options.batchId ?? `bat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const sourceRefs = options.sourceRefs ?? [];
  const provenanceFor = options.provenanceFor ?? (() => undefined);
  const defects: StageResult['defects'] = [];

  // ---- resolve the EXISTING master catalog first (updates beat duplicates) ----
  const world = await prisma.world.findUnique({ where: { id: worldId } });
  if (!world) throw new GovernanceError('world_not_found', 'World not found');
  const v = world.masterVersion;

  const [existingEpochs, existingEntities, existingEvents] = await Promise.all([
    prisma.epoch.findMany({
      where: { worldId, version: v },
      select: { uid: true, name: true, order: true }
    }),
    prisma.entity.findMany({
      where: { worldId, version: v },
      select: { uid: true, name: true, kind: true }
    }),
    prisma.chronicleEvent.findMany({
      where: { worldId, version: v },
      select: { uid: true, title: true, sortOrder: true }
    })
  ]);

  const epochByName = new Map(existingEpochs.map((e) => [NAME_KEY(e.name), e.uid]));
  const entityByName = new Map(existingEntities.map((e) => [NAME_KEY(e.name), e.uid]));
  const eventByTitle = new Map(existingEvents.map((e) => [NAME_KEY(e.title), e.uid]));

  const epochOrder = new Map<number | string, number>();
  for (const e of existingEpochs) epochOrder.set(e.uid, e.order);

  // ---- 1. epochs ----
  const newEpochOrder = new Map<string, number>();
  for (const epoch of generated.epochs) {
    const key = NAME_KEY(epoch.name);
    const existingUid = epochByName.get(key);
    if (existingUid) {
      newEpochOrder.set(epoch.name, epoch.order);
      epochOrder.set(existingUid, epoch.order);
      await submitChange(worldId, {
        kind: 'epoch_upsert',
        targetUid: existingUid,
        payload: {
          name: epoch.name,
          order: epoch.order,
          description: epoch.description,
          startEventUid: null,
          endEventUid: null,
          sourceRefs
        },
        author,
        batchId,
        provenance: provenanceFor('epoch', epoch.name)
      });
    } else {
      const { change } = await submitChange(worldId, {
        kind: 'epoch_upsert',
        payload: {
          name: epoch.name,
          order: epoch.order,
          description: epoch.description,
          sourceRefs
        },
        author,
        batchId,
        provenance: provenanceFor('epoch', epoch.name)
      });
      epochByName.set(key, change.targetUid as string);
      newEpochOrder.set(epoch.name, epoch.order);
      epochOrder.set(change.targetUid as string, epoch.order);
    }
  }

  // ---- 2. entities ----
  for (const entity of generated.entities) {
    const key = NAME_KEY(entity.name);
    const existingUid = entityByName.get(key);
    const payload = {
      kind: entity.kind,
      name: entity.name,
      aliases: entity.aliases,
      summary: entity.summary,
      content: entity.content,
      confidence: entity.confidence,
      tags: entity.tags,
      sourceRefs
    };
    try {
      const { change } = await submitChange(worldId, {
        kind: 'entity_upsert',
        ...(existingUid ? { targetUid: existingUid } : {}),
        payload,
        author,
        batchId,
        provenance: provenanceFor('entity', entity.name)
      });
      if (!existingUid && change.targetUid) entityByName.set(key, change.targetUid);
    } catch (error) {
      defects.push({
        kind: 'entity',
        name: entity.name,
        reason: (error as Error).message.slice(0, 120)
      });
    }
  }

  // ---- 3. events ----
  const eventTitleToUid = new Map(eventByTitle);
  for (const event of generated.events) {
    const key = NAME_KEY(event.title);
    const eventYear = event.year ?? 0;
    if (event.year === null) {
      defects.push({
        kind: 'event',
        name: event.title,
        reason: '年份未提供，暂记为 0（可在编年史里修正）'
      });
    }
    const epochUid = epochByName.get(NAME_KEY(event.epochName));
    if (!epochUid) {
      defects.push({ kind: 'event', name: event.title, reason: `未知纪元: ${event.epochName}` });
      continue;
    }
    const locationUid = event.location
      ? (entityByName.get(NAME_KEY(event.location)) ?? null)
      : null;
    const participants = event.participants
      .map((name) => entityByName.get(NAME_KEY(name)))
      .filter((uid): uid is string => Boolean(uid));

    const existingUid = eventByTitle.get(key);
    try {
      const { change } = await submitChange(worldId, {
        kind: 'event_upsert',
        ...(existingUid ? { targetUid: existingUid } : {}),
        payload: {
          title: event.title,
          summary: event.summary,
          content: event.content,
          epochUid,
          epochYear: eventYear,
          fictionPrecision: 'year',
          locationUid,
          participantUids: participants,
          confidence: event.confidence,
          sourceRefs,
          causeUids: [],
          effectUids: []
        },
        author,
        batchId,
        provenance: provenanceFor('event', event.title)
      });
      if (!existingUid && change.targetUid) eventTitleToUid.set(key, change.targetUid);
    } catch (error) {
      defects.push({
        kind: 'event',
        name: event.title,
        reason: (error as Error).message.slice(0, 120)
      });
    }
  }

  // ---- 3b. causal edges by event title (needs all event uids first) ----
  for (const event of generated.events) {
    const effectUid = eventTitleToUid.get(NAME_KEY(event.title));
    if (!effectUid) continue;
    const causeUids = event.causes
      .map((title) => eventTitleToUid.get(NAME_KEY(title)))
      .filter((uid): uid is string => Boolean(uid));
    if (causeUids.length === 0) continue;
    await submitChange(worldId, {
      kind: 'event_upsert',
      targetUid: effectUid,
      payload: {
        title: event.title,
        summary: event.summary,
        content: event.content,
        epochUid: epochByName.get(NAME_KEY(event.epochName)) ?? null,
        epochYear: event.year ?? 0,
        fictionPrecision: 'year',
        locationUid: event.location ? (entityByName.get(NAME_KEY(event.location)) ?? null) : null,
        participantUids: event.participants
          .map((name) => entityByName.get(NAME_KEY(name)))
          .filter((uid): uid is string => Boolean(uid)),
        confidence: event.confidence,
        sourceRefs,
        causeUids,
        effectUids: []
      },
      author,
      batchId,
      provenance: provenanceFor('event', event.title)
    });
  }

  // ---- 4. relations ----
  for (const relation of generated.relations) {
    const subjectUid = entityByName.get(NAME_KEY(relation.subject));
    const objectUid = entityByName.get(NAME_KEY(relation.object));
    if (!subjectUid || !objectUid) {
      defects.push({
        kind: 'relation',
        name: `${relation.subject}→${relation.object}`,
        reason: !subjectUid ? `未知主体: ${relation.subject}` : `未知客体: ${relation.object}`
      });
      continue;
    }
    const eventUid = relation.eventName
      ? (eventTitleToUid.get(NAME_KEY(relation.eventName)) ?? null)
      : null;
    if (relation.eventName && !eventUid) {
      defects.push({
        kind: 'relation',
        name: `${relation.subject}→${relation.object}`,
        reason: `未知事件: ${relation.eventName}`
      });
      continue;
    }
    try {
      await submitChange(worldId, {
        kind: 'relation_upsert',
        payload: {
          eventUid,
          subjectUid,
          objectUid,
          relation: relation.relation,
          polarity: relation.polarity,
          note: '',
          sourceRefs
        },
        author,
        batchId,
        provenance: provenanceFor(
          'relation',
          `${relation.subject}|${relation.object}|${relation.relation}`
        )
      });
    } catch (error) {
      defects.push({
        kind: 'relation',
        name: `${relation.subject}→${relation.object}`,
        reason: (error as Error).message.slice(0, 120)
      });
    }
  }

  const staged = await prisma.change.count({ where: { worldId, batchId } });
  return {
    batchId,
    staged,
    defects,
    uidMap: {
      epochs: Object.fromEntries([...epochByName.entries()].slice(0, 50)),
      entities: Object.fromEntries([...entityByName.entries()].slice(0, 200)),
      events: Object.fromEntries([...eventTitleToUid.entries()].slice(0, 200))
    }
  };
}
