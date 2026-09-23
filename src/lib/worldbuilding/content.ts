import { prisma } from '@/lib/db/client';
import { GovernanceError, requireWorld } from '@/lib/governance/changes';

/** Read models over versioned content rows (default: master version). */

async function resolveVersion(worldId: string, version?: number | string | null): Promise<number> {
  const world = await requireWorld(worldId);
  if (version === undefined || version === null || version === '') return world.masterVersion;
  const v = Number(version);
  const exists = await prisma.worldVersion.findUnique({
    where: { worldId_version: { worldId, version: v } }
  });
  if (!exists) throw new GovernanceError('version_not_found', `Version ${v} not found`);
  return v;
}

export async function listEntities(
  worldId: string,
  version?: number | string | null,
  kind?: string
) {
  const v = await resolveVersion(worldId, version);
  return prisma.entity.findMany({
    where: { worldId, version: v, ...(kind ? { kind: kind as never } : {}) },
    orderBy: { name: 'asc' }
  });
}

export async function getEntity(worldId: string, uid: string, version?: number | string | null) {
  const v = await resolveVersion(worldId, version);
  const entity = await prisma.entity.findUnique({
    where: { worldId_version_uid: { worldId, version: v, uid } }
  });
  if (!entity) throw new GovernanceError('entity_not_found', 'Entity not found in this version');
  // outgoing + incoming relationship events anchored to this entity (same version)
  const relations = await prisma.relationshipEvent.findMany({
    where: { worldId, version: v, OR: [{ subjectUid: uid }, { objectUid: uid }] },
    orderBy: { uid: 'asc' }
  });
  return { ...entity, relations };
}

export async function listEvents(worldId: string, version?: number | string | null) {
  const v = await resolveVersion(worldId, version);
  return prisma.chronicleEvent.findMany({
    where: { worldId, version: v },
    orderBy: { sortOrder: 'asc' }
  });
}

export async function getEvent(worldId: string, uid: string, version?: number | string | null) {
  const v = await resolveVersion(worldId, version);
  const event = await prisma.chronicleEvent.findUnique({
    where: { worldId_version_uid: { worldId, version: v, uid } }
  });
  if (!event) throw new GovernanceError('event_not_found', 'Event not found in this version');
  const edges = await prisma.eventEdge.findMany({
    where: { worldId, version: v, OR: [{ causeUid: uid }, { effectUid: uid }] }
  });
  const relations = await prisma.relationshipEvent.findMany({
    where: { worldId, version: v, eventUid: uid }
  });
  return { ...event, edges, relations };
}

export async function listEpochs(worldId: string, version?: number | string | null) {
  const v = await resolveVersion(worldId, version);
  return prisma.epoch.findMany({ where: { worldId, version: v }, orderBy: { order: 'asc' } });
}

export async function listRelations(worldId: string, version?: number | string | null) {
  const v = await resolveVersion(worldId, version);
  return prisma.relationshipEvent.findMany({
    where: { worldId, version: v },
    orderBy: { createdAt: 'asc' }
  });
}
