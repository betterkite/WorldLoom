import { prisma } from '@/lib/db/client';
import { getRelationsAt } from '@/lib/worldbuilding/relations';
import { computeRelatedEdges } from '@/lib/graph/relevance';
import { louvain } from '@/lib/graph/louvain';

/**
 * World graph assembly (Phase 4): entity nodes + typed relation edges +
 * computed 5-signal related edges + Louvain communities + usage-free basics.
 * Related edges are computed on demand (legacy ensureRelatedEdges semantics);
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
    active: boolean;
  }[];
  relatedEdges: {
    source: string;
    target: string;
    weight: number;
    signals: Record<string, number>;
  }[];
  communities: { id: number; members: number }[];
}

export async function getWorldGraph(worldId: string): Promise<WorldGraph> {
  const world = await prisma.world.findUnique({ where: { id: worldId } });
  if (!world) throw new Error(`World not found: ${worldId}`);
  const v = world.masterVersion;

  const [entities, events, edges, relations, qaRecords] = await Promise.all([
    prisma.entity.findMany({ where: { worldId, version: v } }),
    prisma.chronicleEvent.findMany({
      where: { worldId, version: v },
      select: { uid: true, participantUids: true }
    }),
    prisma.eventEdge.findMany({ where: { worldId, version: v } }),
    prisma.relationshipEvent.findMany({ where: { worldId, version: v } }),
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
  const relationEdgeViews = relations.map((relation) => ({
    source: relation.subjectUid,
    target: relation.objectUid,
    relation: relation.relation,
    polarity: relation.polarity,
    active: relation.polarity !== 'terminate'
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
 * 标注该时刻的状态 stateAt ∈ active | ended | future（B-5 时间切片着色）。
 */
export async function getFocusGraph(
  worldId: string,
  view: 'relations' | 'events',
  options: { asOf?: string | null } = {}
) {
  const world = await prisma.world.findUnique({ where: { id: worldId } });
  if (!world) throw new Error(`World not found: ${worldId}`);
  const v = world.masterVersion;

  if (view === 'relations') {
    const [entities, relations, events] = await Promise.all([
      prisma.entity.findMany({
        where: { worldId, version: v },
        select: { uid: true, name: true, kind: true }
      }),
      prisma.relationshipEvent.findMany({ where: { worldId, version: v } }),
      prisma.chronicleEvent.findMany({
        where: { worldId, version: v },
        select: { uid: true, title: true, locationUid: true, sortOrder: true }
      })
    ]);
    const entityKind = new Map(entities.map((e) => [e.uid, e.kind]));
    const nameOf = new Map(entities.map((e) => [e.uid, e.name]));
    const eventByUid = new Map(events.map((e) => [e.uid, e]));
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
      stateAt?: 'active' | 'ended' | 'future';
    }[] = relations
      .filter(
        (r) =>
          nodeKinds.has(entityKind.get(r.subjectUid) ?? '') &&
          nodeKinds.has(entityKind.get(r.objectUid) ?? '')
      )
      .map((r) => {
        const event = r.eventUid ? eventByUid.get(r.eventUid) : null;
        nodeUids.add(r.subjectUid);
        nodeUids.add(r.objectUid);
        return {
          id: r.uid,
          source: r.subjectUid,
          target: r.objectUid,
          relation: r.relation,
          label: r.polarity === 'terminate' ? `${r.relation}·终止` : r.relation,
          polarity: r.polarity,
          eventTitle: event?.title ?? null,
          locationName: event?.locationUid ? (nameOf.get(event.locationUid) ?? null) : null,
          sortOrder: event?.sortOrder ?? -1
        };
      })
      .toSorted((a, b) => a.sortOrder - b.sortOrder);

    // B-5 时间切片着色：asOf 时刻的关系折叠态（active/ended/future）
    let asOfInfo: { eventUid: string | null; title: string | null } | null = null;
    if (options.asOf) {
      const slice = await getRelationsAt(worldId, { atEventUid: options.asOf });
      asOfInfo = { eventUid: slice.asOf.eventUid, title: slice.asOf.title };
      const threshold = slice.asOf.sortOrder ?? Number.POSITIVE_INFINITY;
      const activeKeys = new Set(
        slice.edges
          .filter((e) => e.active)
          .map((e) => `${e.subjectUid}|${e.objectUid}|${e.relation}`)
      );
      for (const edge of edges) {
        if (edge.sortOrder > threshold) {
          edge.stateAt = 'future';
        } else {
          const key = `${edge.source}|${edge.target}|${edge.relation}`;
          edge.stateAt = activeKeys.has(key) ? 'active' : 'ended';
        }
      }
    } else {
      for (const edge of edges) edge.stateAt = edge.polarity === 'terminate' ? 'ended' : 'active';
    }

    return {
      view,
      version: v,
      asOf: asOfInfo,
      anchorEvents: events
        .slice()
        .toSorted((a, b) => a.sortOrder - b.sortOrder)
        .map((e) => ({ uid: e.uid, title: e.title, sortOrder: e.sortOrder })),
      nodes: entities
        .filter((e) => nodeUids.has(e.uid))
        .map((e) => ({ uid: e.uid, name: e.name, kind: e.kind })),
      edges
    };
  }

  const events = await prisma.chronicleEvent.findMany({
    where: { worldId, version: v },
    orderBy: { sortOrder: 'asc' }
  });
  const edges = await prisma.eventEdge.findMany({ where: { worldId, version: v } });
  const inGraph = new Set<string>();
  for (const edge of edges) {
    inGraph.add(edge.causeUid);
    inGraph.add(edge.effectUid);
  }
  return {
    view,
    version: v,
    nodes: events
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
