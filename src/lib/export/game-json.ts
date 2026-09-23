import { prisma } from '@/lib/db/client';
import { requireWorld } from '@/lib/governance/changes';
import { formatFictionDate, parseCalendar } from '@/lib/worldbuilding/calendar';

/**
 * C-3 游戏引擎 JSON 导出：把主版本世界导出为引擎友好的结构化数据
 * （纪元 / 条目 / 事件含虚构日期与因果 / 关系事件 / 未回收伏笔）。
 */
export async function buildGameBundle(worldId: string) {
  const world = await requireWorld(worldId);
  const v = world.masterVersion;

  const [epochs, entities, events, edges, relations, foreshadows] = await Promise.all([
    prisma.epoch.findMany({ where: { worldId, version: v }, orderBy: { order: 'asc' } }),
    prisma.entity.findMany({ where: { worldId, version: v }, orderBy: { name: 'asc' } }),
    prisma.chronicleEvent.findMany({
      where: { worldId, version: v },
      orderBy: { sortOrder: 'asc' }
    }),
    prisma.eventEdge.findMany({ where: { worldId, version: v } }),
    prisma.relationshipEvent.findMany({ where: { worldId, version: v } }),
    prisma.foreshadow.findMany({ where: { worldId }, orderBy: { createdAt: 'asc' } })
  ]);

  const calendar = parseCalendar(world.calendarJson);
  const epochByUid = new Map(epochs.map((e) => [e.uid, e]));
  const causesByEffect = new Map<string, string[]>();
  const effectsByCause = new Map<string, string[]>();
  for (const edge of edges) {
    causesByEffect.set(edge.effectUid, [
      ...(causesByEffect.get(edge.effectUid) ?? []),
      edge.causeUid
    ]);
    effectsByCause.set(edge.causeUid, [
      ...(effectsByCause.get(edge.causeUid) ?? []),
      edge.effectUid
    ]);
  }

  return {
    schemaVersion: 1,
    generator: 'WorldLoom',
    exportedAt: new Date().toISOString(),
    world: {
      id: world.id,
      name: world.name,
      premise: world.premise,
      style: world.style,
      masterVersion: v,
      ingestMode: world.ingestMode,
      calendar
    },
    epochs: epochs.map((epoch) => ({
      uid: epoch.uid,
      name: epoch.name,
      order: epoch.order,
      description: epoch.description,
      startEventUid: epoch.startEventUid,
      endEventUid: epoch.endEventUid,
      sourceRefs: epoch.sourceRefs
    })),
    entities: entities.map((entity) => ({
      uid: entity.uid,
      kind: entity.kind,
      name: entity.name,
      aliases: entity.aliases,
      summary: entity.summary,
      content: entity.content,
      confidence: entity.confidence,
      tags: entity.tags,
      sourceRefs: entity.sourceRefs
    })),
    events: events.map((event) => ({
      uid: event.uid,
      title: event.title,
      summary: event.summary,
      content: event.content,
      epochUid: event.epochUid,
      epochName: event.epochUid ? (epochByUid.get(event.epochUid)?.name ?? null) : null,
      year: event.epochYear,
      month: event.epochMonth ?? null,
      day: event.epochDay ?? null,
      dateLabel: formatFictionDate(
        { year: event.epochYear, month: event.epochMonth ?? null, day: event.epochDay ?? null },
        calendar
      ),
      precision: event.fictionPrecision,
      sortOrder: event.sortOrder,
      locationUid: event.locationUid,
      participantUids: event.participantUids,
      confidence: event.confidence,
      sourceRefs: event.sourceRefs,
      causes: causesByEffect.get(event.uid) ?? [],
      effects: effectsByCause.get(event.uid) ?? []
    })),
    relationships: relations.map((relation) => ({
      uid: relation.uid,
      subjectUid: relation.subjectUid,
      objectUid: relation.objectUid,
      relation: relation.relation,
      polarity: relation.polarity,
      note: relation.note,
      eventUid: relation.eventUid,
      sourceRefs: relation.sourceRefs
    })),
    foreshadows: foreshadows.map((foreshadow) => ({
      uid: foreshadow.uid,
      title: foreshadow.title,
      detail: foreshadow.detail,
      status: foreshadow.status,
      plantedEventUid: foreshadow.plantedEventUid,
      resolvedEventUid: foreshadow.resolvedEventUid
    })),
    stats: {
      epochs: epochs.length,
      entities: entities.length,
      events: events.length,
      relationships: relations.length,
      foreshadows: foreshadows.length,
      openForeshadows: foreshadows.filter((f) => f.status === 'open').length
    }
  };
}
