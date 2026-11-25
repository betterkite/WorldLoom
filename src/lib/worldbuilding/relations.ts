import { prisma } from '@/lib/db/client';
import { GovernanceError, requireWorld } from '@/lib/governance/changes';
import { createChronology } from './chronology';

export interface RelationEdge {
  subjectUid: string;
  objectUid: string;
  subjectName: string;
  objectName: string;
  relation: string;
  polarity: string;
  active: boolean | null;
  ambiguous: boolean;
  sourceEventUids: (string | null)[];
  sourceRelationUids: string[];
  lastEventUid: string | null;
  lastSortOrder: number;
}

export interface RelationsAtResult {
  version: number;
  ordering: 'fiction-date' | 'legacy-sortOrder';
  warning?: string;
  asOf: { eventUid: string | null; sortOrder: number | null; title: string | null };
  edges: RelationEdge[];
  counts: {
    active: number;
    weakened: number;
    terminated: number;
    foundational: number;
    ambiguous: number;
  };
}

/** Fold maximal relationship changes under the date partial order. Overlapping
 * dates do not get an invented order from insertion time, display rank or UID. */
export async function getRelationsAt(
  worldId: string,
  options: {
    version?: number | string | null;
    atEventUid?: string | null;
    atSortOrder?: number | null;
  } = {}
): Promise<RelationsAtResult> {
  const world = await requireWorld(worldId);
  const version =
    options.version == null || options.version === ''
      ? world.masterVersion
      : Number(options.version);
  if (!Number.isSafeInteger(version) || version < 1)
    throw new GovernanceError('version_not_found', 'Invalid version');
  const snapshot = await prisma.worldVersion.findUnique({
    where: { worldId_version: { worldId, version } }
  });
  if (!snapshot) throw new GovernanceError('version_not_found', 'Version not found');
  const legacy = options.atSortOrder != null;
  if (legacy && (!Number.isFinite(options.atSortOrder) || options.atEventUid)) {
    throw new GovernanceError(
      'invalid_time_cursor',
      'Use one finite numeric cursor or one event anchor'
    );
  }
  if (legacy && snapshot.chronologyFormat !== 'legacy') {
    throw new GovernanceError('legacy_time_cursor', 'Use version and atEvent for this snapshot', {
      version
    });
  }
  const [entities, events, relations, epochs] = await Promise.all([
    prisma.entity.findMany({ where: { worldId, version }, select: { uid: true, name: true } }),
    prisma.chronicleEvent.findMany({ where: { worldId, version } }),
    prisma.relationshipEvent.findMany({
      where: { worldId, version },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    }),
    prisma.epoch.findMany({ where: { worldId, version } })
  ]);
  const chronology = createChronology(events, epochs);
  const entityName = new Map(entities.map((entity) => [entity.uid, entity.name]));
  const anchor = options.atEventUid ? chronology.byUid.get(options.atEventUid) : undefined;
  if (options.atEventUid && !anchor)
    throw new GovernanceError('event_not_found', 'Anchor event not found in this version');
  const asOf = anchor
    ? { eventUid: anchor.uid, sortOrder: anchor.sortOrder, title: anchor.title }
    : { eventUid: null, sortOrder: legacy ? Number(options.atSortOrder) : null, title: null };

  const candidates = relations.flatMap((relation) => {
    const event = relation.eventUid ? chronology.byUid.get(relation.eventUid) : undefined;
    const foundational = relation.eventUid === null;
    if (legacy) {
      if (!foundational && !event) return [];
      const storedOrder = foundational ? -1 : event!.sortOrder;
      if (storedOrder > Number(options.atSortOrder)) return [];
    }
    const membership = foundational
      ? 'included'
      : !event
        ? 'uncertain'
        : anchor
          ? chronology.atAnchor(event, anchor)
          : 'included';
    if (!legacy && membership === 'future') return [];
    return [
      {
        relation,
        event,
        foundational,
        membership,
        sortOrder: foundational ? -1 : (event?.sortOrder ?? -1)
      }
    ];
  });
  type Candidate = (typeof candidates)[number];
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const relation = candidate.relation;
    const key = JSON.stringify([relation.subjectUid, relation.objectUid, relation.relation]);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  const edges: RelationEdge[] = [];
  for (const group of groups.values()) {
    const maximal = legacy
      ? [group.toSorted((a, b) => a.sortOrder - b.sortOrder).at(-1)!]
      : group.filter(
          (candidate) =>
            !group.some((other) => {
              if (candidate === other || other.membership !== 'included' || !other.event)
                return false;
              return (
                candidate.foundational ||
                (!!candidate.event && chronology.before(candidate.event, other.event))
              );
            })
        );
    const polarities = new Set(maximal.map((item) => item.relation.polarity));
    const ambiguous =
      maximal.some((item) => item.membership === 'uncertain') || polarities.size !== 1;
    const representative = maximal[0];
    const relation = representative.relation;
    edges.push({
      subjectUid: relation.subjectUid,
      objectUid: relation.objectUid,
      subjectName: entityName.get(relation.subjectUid) ?? relation.subjectUid,
      objectName: entityName.get(relation.objectUid) ?? relation.objectUid,
      relation: relation.relation,
      polarity: ambiguous ? 'ambiguous' : relation.polarity,
      active: ambiguous ? null : relation.polarity !== 'terminate',
      ambiguous,
      sourceEventUids: [...new Set(maximal.map((item) => item.relation.eventUid))],
      sourceRelationUids: maximal.map((item) => item.relation.uid).toSorted(),
      lastEventUid: maximal.length === 1 ? relation.eventUid : null,
      lastSortOrder: Math.max(...maximal.map((item) => item.sortOrder))
    });
  }
  edges.sort((a, b) => a.subjectName.localeCompare(b.subjectName));
  const counts = { active: 0, weakened: 0, terminated: 0, foundational: 0, ambiguous: 0 };
  for (const edge of edges) {
    if (edge.ambiguous) counts.ambiguous += 1;
    else if (edge.active === false) counts.terminated += 1;
    else if (edge.polarity === 'weaken') counts.weakened += 1;
    else {
      counts.active += 1;
      if (edge.sourceEventUids.every((uid) => uid === null)) counts.foundational += 1;
    }
  }
  return {
    version,
    ordering: legacy ? 'legacy-sortOrder' : 'fiction-date',
    ...(legacy
      ? { warning: '旧数字游标保留原快照的粗粒度排序；精确切片请使用 version 与 atEvent。' }
      : {}),
    asOf,
    edges,
    counts
  };
}
