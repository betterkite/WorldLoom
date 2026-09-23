import { prisma } from '@/lib/db/client';
import { GovernanceError, requireWorld } from '@/lib/governance/changes';
import { formatFictionDate, parseCalendar } from './calendar';

/**
 * Timeline read model (Phase 3): events grouped into epoch segments with
 * causal edges resolved for drawing. Optional server-side filters keep the
 * client payload bounded.
 */

export interface TimelineSegment {
  epochUid: string | null;
  epochName: string;
  order: number;
  minYear: number | null;
  maxYear: number | null;
  events: TimelineEvent[];
}

export interface TimelineEvent {
  uid: string;
  title: string;
  summary: string;
  epochUid: string | null;
  epochName: string;
  year: number | null;
  month: number | null;
  day: number | null;
  dateLabel: string;
  sortOrder: number;
  participantUids: string[];
  participantNames: string[];
  locationUid: string | null;
  confidence: string;
  causes: string[]; // event uids
  effects: string[]; // event uids
}

export interface TimelineResult {
  version: number;
  segments: TimelineSegment[];
  edges: { causeUid: string; effectUid: string }[];
  entityIndex: { uid: string; name: string; kind: string }[];
}

export async function getTimeline(
  worldId: string,
  options: { version?: number | string | null; participantUid?: string | null } = {}
): Promise<TimelineResult> {
  const world = await requireWorld(worldId);
  const version = options.version ? Number(options.version) : world.masterVersion;
  const exists = await prisma.worldVersion.findUnique({
    where: { worldId_version: { worldId, version } }
  });
  if (!exists) throw new GovernanceError('version_not_found', `Version ${version} not found`);

  const [epochs, entities, events, edges] = await Promise.all([
    prisma.epoch.findMany({ where: { worldId, version }, orderBy: { order: 'asc' } }),
    prisma.entity.findMany({
      where: { worldId, version },
      select: { uid: true, name: true, kind: true }
    }),
    prisma.chronicleEvent.findMany({ where: { worldId, version }, orderBy: { sortOrder: 'asc' } }),
    prisma.eventEdge.findMany({ where: { worldId, version } })
  ]);

  const calendar = parseCalendar(world.calendarJson);
  const entityName = new Map(entities.map((e) => [e.uid, e.name]));
  const epochById = new Map(epochs.map((e) => [e.uid, e]));
  const causesByEffect = new Map<string, string[]>();
  const effectsByCause = new Map<string, string[]>();
  for (const edge of edges) {
    effectsByCause.set(edge.causeUid, [
      ...(effectsByCause.get(edge.causeUid) ?? []),
      edge.effectUid
    ]);
    causesByEffect.set(edge.effectUid, [
      ...(causesByEffect.get(edge.effectUid) ?? []),
      edge.causeUid
    ]);
  }

  const filtered = options.participantUid
    ? events.filter((event) => event.participantUids.includes(options.participantUid as string))
    : events;

  const toEvent = (event: (typeof events)[number]): TimelineEvent => ({
    uid: event.uid,
    title: event.title,
    summary: event.summary,
    epochUid: event.epochUid,
    epochName: event.epochUid ? (epochById.get(event.epochUid)?.name ?? '未知纪元') : '未分期',
    year: event.epochYear,
    month: event.epochMonth ?? null,
    day: event.epochDay ?? null,
    dateLabel: formatFictionDate(
      { year: event.epochYear, month: event.epochMonth ?? null, day: event.epochDay ?? null },
      calendar
    ),
    sortOrder: event.sortOrder,
    participantUids: event.participantUids,
    participantNames: event.participantUids.map((uid) => entityName.get(uid) ?? uid),
    locationUid: event.locationUid,
    confidence: event.confidence,
    causes: causesByEffect.get(event.uid) ?? [],
    effects: effectsByCause.get(event.uid) ?? []
  });

  // segment key: epoch uid (unanchored events → synthetic segment first)
  const segments = new Map<string, TimelineSegment>();
  for (const epoch of epochs) {
    segments.set(epoch.uid, {
      epochUid: epoch.uid,
      epochName: epoch.name,
      order: epoch.order,
      minYear: null,
      maxYear: null,
      events: []
    });
  }
  segments.set('__unsequenced__', {
    epochUid: null,
    epochName: '未分期',
    order: -1,
    minYear: null,
    maxYear: null,
    events: []
  });

  for (const event of filtered) {
    const key = event.epochUid && segments.has(event.epochUid) ? event.epochUid : '__unsequenced__';
    const segment = segments.get(key) as TimelineSegment;
    segment.events.push(toEvent(event));
    if (event.epochYear !== null) {
      segment.minYear =
        segment.minYear === null ? event.epochYear : Math.min(segment.minYear, event.epochYear);
      segment.maxYear =
        segment.maxYear === null ? event.epochYear : Math.max(segment.maxYear, event.epochYear);
    }
  }

  const visible = new Set(filtered.map((event) => event.uid));
  return {
    version,
    segments: [...segments.values()]
      .filter((segment) => segment.events.length > 0)
      .toSorted((a, b) => a.order - b.order),
    edges: edges
      .filter((edge) => visible.has(edge.causeUid) && visible.has(edge.effectUid))
      .map((edge) => ({ causeUid: edge.causeUid, effectUid: edge.effectUid })),
    entityIndex: entities
  };
}
