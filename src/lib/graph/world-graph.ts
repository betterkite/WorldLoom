import { prisma } from '@/lib/db/client';
import { GovernanceError } from '@/lib/governance/changes';
import { getRelationsAt } from '@/lib/worldbuilding/relations';
import { CHRONOLOGY_FORMAT, createChronology } from '@/lib/worldbuilding/chronology';
import { computeRelatedEdges } from '@/lib/graph/relevance';
import { louvain } from '@/lib/graph/louvain';

/**
 * World graph assembly (Phase 4): entity nodes + typed relation edges +
 * computed 5-signal related edges + Louvain communities + usage-free basics.
 * Related edges are computed on demand;
 * persistence deferred until scale requires it.
 */

export interface WorldGraph {
  version: number;
  nodes: {
    uid: string;
    name: string;
    kind: string;
    community: number;
    degree: number;
    queryHits: number;
  }[];
  relationEdges: {
    source: string;
    target: string;
    relation: string;
    polarity: string;
    active: boolean | null;
    ambiguous: boolean;
    sourceEventUids: (string | null)[];
    sourceRelationUids: string[];
  }[];
  relatedEdges: {
    source: string;
    target: string;
    weight: number;
    signals: Record<string, number>;
  }[];
  communities: { id: number; members: number }[];
}

type GraphVersionOptions = { version?: number | string | null };

function relationKey(subject: string, object: string, relation: string): string {
  return JSON.stringify([subject, object, relation]);
}

async function resolveGraphVersion(worldId: string, requested: GraphVersionOptions['version']) {
  const world = await prisma.world.findUnique({ where: { id: worldId } });
  if (!world) throw new Error(`World not found: ${worldId}`);
  const version = requested == null || requested === '' ? world.masterVersion : Number(requested);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new GovernanceError('version_not_found', 'Invalid version');
  }
  const snapshot = await prisma.worldVersion.findUnique({
    where: { worldId_version: { worldId, version } }
  });
  if (!snapshot) throw new GovernanceError('version_not_found', 'Version not found');
  return version;
}

export async function getWorldGraph(
  worldId: string,
  options: GraphVersionOptions = {}
): Promise<WorldGraph> {
  const v = await resolveGraphVersion(worldId, options.version);

  const [entities, events, edges, relations, qaRecords] = await Promise.all([
    prisma.entity.findMany({ where: { worldId, version: v } }),
    prisma.chronicleEvent.findMany({
      where: { worldId, version: v },
      select: { uid: true, participantUids: true }
    }),
    prisma.eventEdge.findMany({ where: { worldId, version: v } }),
    getRelationsAt(worldId, { version: v }),
    prisma.qaRecord.findMany({ where: { worldId }, select: { citations: true } })
  ]);

  // C-6 引用热度：统计每个条目/事件被世界知识助手答案引用的次数
  const hits = new Map<string, number>();
  for (const record of qaRecords) {
    const citations = (record.citations ?? []) as { uid?: string }[];
    for (const citation of citations) {
      if (citation?.uid) hits.set(citation.uid, (hits.get(citation.uid) ?? 0) + 1);
    }
  }
  // entities are the graph nodes; events contribute causal links among their
  // participants (participant A — event — participant B)
  const causalPairs: [string, string][] = [];
  for (const edge of edges) causalPairs.push([edge.causeUid, edge.effectUid]);
  for (const event of events) {
    const participants = event.participantUids;
    for (let i = 0; i < participants.length; i += 1) {
      for (let j = i + 1; j < participants.length; j += 1) {
        causalPairs.push([participants[i], participants[j]]);
      }
    }
  }

  const nodeInputs = entities.map((entity) => ({
    uid: entity.uid,
    kind: entity.kind,
    name: entity.name,
    summary: entity.summary,
    tags: entity.tags,
    sourceRefs: entity.sourceRefs
  }));
  const allRelated = computeRelatedEdges(nodeInputs, causalPairs);
  // 减负：弱信号单支撑的边（权重 < 2.5，即纯词法/纯 Adamic）默认不画；
  // 每节点最多保留 3 条最强相关边；总量封顶 2×节点数。完整边集仍可导出。
  const byNode = new Map<string, { source: string; target: string; weight: number }[]>();
  for (const edge of allRelated) {
    if (edge.weight < 2.5) continue;
    for (const uid of [edge.source, edge.target]) {
      const list = byNode.get(uid) ?? [];
      list.push(edge);
      byNode.set(uid, list);
    }
  }
  const kept = new Set<string>();
  for (const [, list] of byNode) {
    for (const edge of [...list].toSorted((a, b) => b.weight - a.weight).slice(0, 3)) {
      kept.add(`${edge.source}|${edge.target}`);
    }
  }
  const relatedEdges = [...kept]
    .map((k) => k.split('|'))
    .map(([source, target]) => allRelated.find((e) => e.source === source && e.target === target)!)
    .filter(Boolean)
    .slice(0, Math.max(30, entities.length * 2));

  const { communities } = louvain(
    entities.map((entity) => ({ id: entity.uid })),
    relatedEdges
  );

  const degree = new Map<string, number>();
  for (const edge of relatedEdges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const relationEdgeViews = relations.edges.map((relation) => ({
    source: relation.subjectUid,
    target: relation.objectUid,
    relation: relation.relation,
    polarity: relation.polarity,
    active: relation.active,
    ambiguous: relation.ambiguous,
    sourceEventUids: relation.sourceEventUids,
    sourceRelationUids: relation.sourceRelationUids
  }));

  return {
    version: v,
    nodes: entities.map((entity) => ({
      uid: entity.uid,
      name: entity.name,
      kind: entity.kind,
      community: communities[entity.uid] ?? 0,
      degree: degree.get(entity.uid) ?? 0,
      queryHits: hits.get(entity.uid) ?? 0
    })),
    relationEdges: relationEdgeViews,
    relatedEdges,
    communities: Object.entries(
      entities.reduce<Record<number, number>>((acc, entity) => {
        const c = communities[entity.uid] ?? 0;
        acc[c] = (acc[c] ?? 0) + 1;
        return acc;
      }, {})
    ).map(([id, members]) => ({ id: Number(id), members }))
  };
}

/**
 * ISS-18 图谱分图：view=relations（人物关系，边标注事件与地点）/ view=events（事件因果）。
 * options.asOf = 锚点事件 uid：按关系时间切片（getRelationsAt 折叠语义）为每条边
 * 标注该时刻的状态 stateAt ∈ active | ended | future | uncertain。
 */
export async function getFocusGraph(
  worldId: string,
  view: 'relations' | 'events',
  options: GraphVersionOptions & { asOf?: string | null } = {}
) {
  const v = await resolveGraphVersion(worldId, options.version);

  if (view === 'relations') {
    const [entities, relations, events, epochs, slice] = await Promise.all([
      prisma.entity.findMany({
        where: { worldId, version: v },
        select: { uid: true, name: true, kind: true }
      }),
      prisma.relationshipEvent.findMany({ where: { worldId, version: v } }),
      prisma.chronicleEvent.findMany({
        where: { worldId, version: v },
        select: {
          uid: true,
          title: true,
          locationUid: true,
          sortOrder: true,
          epochUid: true,
          epochYear: true,
          epochMonth: true,
          epochDay: true,
          fictionPrecision: true
        }
      }),
      prisma.epoch.findMany({ where: { worldId, version: v }, select: { uid: true, order: true } }),
      getRelationsAt(worldId, { version: v, atEventUid: options.asOf })
    ]);
    const entityKind = new Map(entities.map((e) => [e.uid, e.kind]));
    const nameOf = new Map(entities.map((e) => [e.uid, e.name]));
    const chronology = createChronology(events, epochs);
    const eventByUid = chronology.byUid;
    const anchor = options.asOf ? eventByUid.get(options.asOf) : null;
    const folded = new Map(
      slice.edges.map((edge) => [relationKey(edge.subjectUid, edge.objectUid, edge.relation), edge])
    );
    // 只保留"人物/组织/势力"这类有能动性的节点
    const nodeKinds = new Set(['character', 'organization', 'faction', 'species']);
    const nodeUids = new Set<string>();
    const edges: {
      id: string;
      source: string;
      target: string;
      relation: string;
      label: string;
      polarity: string;
      eventTitle: string | null;
      locationName: string | null;
      sortOrder: number;
      chronologyPosition: number | null;
      stateAt: 'active' | 'ended' | 'future' | 'uncertain';
      sourceEventUids: (string | null)[];
      sourceRelationUids: string[];
    }[] = relations
      .filter(
        (r) =>
          nodeKinds.has(entityKind.get(r.subjectUid) ?? '') &&
          nodeKinds.has(entityKind.get(r.objectUid) ?? '')
      )
      .map((r) => {
        const event = r.eventUid ? eventByUid.get(r.eventUid) : null;
        const state = folded.get(relationKey(r.subjectUid, r.objectUid, r.relation));
        let membership: 'included' | 'future' | 'uncertain' = 'included';
        if (r.eventUid && !event) membership = 'uncertain';
        else if (options.asOf) {
          membership = !anchor
            ? 'uncertain'
            : event
              ? chronology.atAnchor(event, anchor)
              : 'included';
        }
        const stateAt: 'active' | 'ended' | 'future' | 'uncertain' =
          membership === 'future'
            ? 'future'
            : membership === 'uncertain' || !state || state.ambiguous || state.active === null
              ? 'uncertain'
              : state.active
                ? 'active'
                : 'ended';
        const sources = membership === 'future' ? undefined : state;
        nodeUids.add(r.subjectUid);
        nodeUids.add(r.objectUid);
        return {
          id: r.uid,
          source: r.subjectUid,
          target: r.objectUid,
          relation: r.relation,
          // Label the recorded action; stateAt describes its state at the selected time.
          label: r.polarity === 'terminate' ? `${r.relation}·终止` : r.relation,
          polarity: r.polarity,
          eventTitle: event?.title ?? null,
          locationName: event?.locationUid ? (nameOf.get(event.locationUid) ?? null) : null,
          sortOrder: event?.sortOrder ?? -1,
          chronologyPosition: event?.chronologyPosition ?? (r.eventUid ? null : 0),
          stateAt,
          sourceEventUids: sources?.sourceEventUids ?? [r.eventUid],
          sourceRelationUids: sources?.sourceRelationUids ?? [r.uid]
        };
      })
      .toSorted(
        (a, b) =>
          (a.chronologyPosition ?? Number.MAX_SAFE_INTEGER) -
            (b.chronologyPosition ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)
      );

    return {
      view,
      version: v,
      ordering: slice.ordering,
      asOf: options.asOf ? slice.asOf : null,
      anchorEvents: chronology.events.map((e) => ({
        uid: e.uid,
        title: e.title,
        sortOrder: e.sortOrder,
        chronologyPosition: e.chronologyPosition
      })),
      nodes: entities
        .filter((e) => nodeUids.has(e.uid))
        .map((e) => ({ uid: e.uid, name: e.name, kind: e.kind })),
      edges
    };
  }

  const [events, epochs, edges] = await Promise.all([
    prisma.chronicleEvent.findMany({ where: { worldId, version: v } }),
    prisma.epoch.findMany({ where: { worldId, version: v } }),
    prisma.eventEdge.findMany({ where: { worldId, version: v } })
  ]);
  const chronology = createChronology(events, epochs);
  const inGraph = new Set<string>();
  for (const edge of edges) {
    inGraph.add(edge.causeUid);
    inGraph.add(edge.effectUid);
  }
  return {
    view,
    version: v,
    ordering: CHRONOLOGY_FORMAT,
    nodes: chronology.events
      .filter((e) => inGraph.has(e.uid))
      .map((e) => ({ uid: e.uid, name: e.title, kind: 'event', year: e.epochYear })),
    edges: edges.map((edge, index) => ({
      id: `edge_${index}`,
      source: edge.causeUid,
      target: edge.effectUid,
      label: '因果',
      polarity: 'causal',
      eventTitle: null,
      locationName: null,
      sortOrder: 0
    }))
  };
}
