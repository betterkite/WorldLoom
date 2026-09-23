import { prisma } from '@/lib/db/client';
import { GovernanceError, requireWorld } from '@/lib/governance/changes';

/**
 * Relationship time-slicing (Phase 3).
 *
 * RelationshipEvents are event-sourced: each row is anchored to a chronicle
 * event (or is foundational when unanchored). The relationship state "as of"
 * an event T = fold of every relationship event whose anchor sortOrder ≤ T.
 * Polarity semantics over the fold (latest wins per directed pair+relation):
 *   establish/strengthen → active · weaken → active (weakened) · terminate → gone
 */

export interface RelationEdge {
  subjectUid: string;
  objectUid: string;
  subjectName: string;
  objectName: string;
  relation: string;
  polarity: string;
  active: boolean;
  lastEventUid: string | null;
  lastSortOrder: number;
}

export interface RelationsAtResult {
  asOf: { eventUid: string | null; sortOrder: number | null; title: string | null };
  edges: RelationEdge[];
  counts: { active: number; weakened: number; terminated: number; foundational: number };
}

export async function getRelationsAt(
  worldId: string,
  options: {
    version?: number | string | null;
    atEventUid?: string | null;
    atSortOrder?: number | null;
  } = {}
): Promise<RelationsAtResult> {
  const world = await requireWorld(worldId);
  const version = options.version ? Number(options.version) : world.masterVersion;

  const [entities, events, relations] = await Promise.all([
    prisma.entity.findMany({ where: { worldId, version }, select: { uid: true, name: true } }),
    prisma.chronicleEvent.findMany({
      where: { worldId, version },
      select: { uid: true, title: true, sortOrder: true }
    }),
    prisma.relationshipEvent.findMany({ where: { worldId, version } })
  ]);

  const entityName = new Map(entities.map((e) => [e.uid, e.name]));
  const eventMap = new Map(events.map((e) => [e.uid, e]));

  let threshold = Number.POSITIVE_INFINITY;
  let asOfEvent: { eventUid: string | null; sortOrder: number | null; title: string | null } = {
    eventUid: null,
    sortOrder: null,
    title: null
  };

  if (options.atEventUid) {
    const anchor = eventMap.get(options.atEventUid);
    if (!anchor)
      throw new GovernanceError('event_not_found', 'Anchor event not found in this version');
    threshold = anchor.sortOrder;
    asOfEvent = { eventUid: anchor.uid, sortOrder: anchor.sortOrder, title: anchor.title };
  } else if (options.atSortOrder !== undefined && options.atSortOrder !== null) {
    threshold = Number(options.atSortOrder);
    asOfEvent = { eventUid: null, sortOrder: threshold, title: null };
  }

  // chronological fold: foundational relations first, then by anchor sortOrder
  const sorted = relations
    .map((relation) => ({
      relation,
      anchorSort: relation.eventUid
        ? (eventMap.get(relation.eventUid)?.sortOrder ?? Number.POSITIVE_INFINITY)
        : -1
    }))
    .filter((item) => item.anchorSort <= threshold)
    .toSorted((a, b) => a.anchorSort - b.anchorSort);

  const folded = new Map<string, RelationEdge>();
  const counts = { active: 0, weakened: 0, terminated: 0, foundational: 0 };

  for (const { relation, anchorSort } of sorted) {
    const key = `${relation.subjectUid}|${relation.objectUid}|${relation.relation}`;
    folded.set(key, {
      subjectUid: relation.subjectUid,
      objectUid: relation.objectUid,
      subjectName: entityName.get(relation.subjectUid) ?? relation.subjectUid,
      objectName: entityName.get(relation.objectUid) ?? relation.objectUid,
      relation: relation.relation,
      polarity: relation.polarity,
      active: relation.polarity !== 'terminate',
      lastEventUid: relation.eventUid,
      lastSortOrder: anchorSort
    });
  }

  const edges = [...folded.values()].toSorted((a, b) => a.subjectName.localeCompare(b.subjectName));
  for (const edge of edges) {
    if (!edge.active) counts.terminated += 1;
    else if (edge.polarity === 'weaken') counts.weakened += 1;
    else {
      counts.active += 1;
      if (edge.lastSortOrder === -1) counts.foundational += 1;
    }
  }

  return { asOf: asOfEvent, edges, counts };
}
