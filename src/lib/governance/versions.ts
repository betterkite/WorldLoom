import { prisma } from '@/lib/db/client';
import { GovernanceError, requireWorld } from './changes';

/** Version list with pending-change counters for the review UI. */
export async function listVersions(worldId: string) {
  await requireWorld(worldId);
  const versions = await prisma.worldVersion.findMany({
    where: { worldId },
    orderBy: { version: 'desc' }
  });
  const pending = await prisma.change.count({ where: { worldId, status: 'pending' } });
  return { pending, versions };
}

/** Snapshot content at a specific version (immutable read). */
export async function getVersionSnapshot(worldId: string, version: number) {
  const world = await requireWorld(worldId);
  const row = await prisma.worldVersion.findUnique({
    where: { worldId_version: { worldId, version } }
  });
  if (!row) throw new GovernanceError('version_not_found', `Version ${version} not found`);

  const [epochs, entities, events, edges, relations, conflicts, tombstones] = await Promise.all([
    prisma.epoch.findMany({ where: { worldId, version }, orderBy: { order: 'asc' } }),
    prisma.entity.findMany({ where: { worldId, version }, orderBy: { name: 'asc' } }),
    prisma.chronicleEvent.findMany({ where: { worldId, version }, orderBy: { sortOrder: 'asc' } }),
    prisma.eventEdge.findMany({ where: { worldId, version } }),
    prisma.relationshipEvent.findMany({ where: { worldId, version } }),
    prisma.conflictRecord.findMany({ where: { worldId, version }, orderBy: { createdAt: 'desc' } }),
    prisma.tombstone.findMany({ where: { worldId, deletedAtVersion: version } })
  ]);

  return {
    version,
    summary: row.summary,
    changeCount: row.changeCount,
    conflictCount: row.conflictCount,
    createdAt: row.createdAt,
    isMaster: world.masterVersion === version,
    counts: {
      epochs: epochs.length,
      entities: entities.length,
      events: events.length,
      edges: edges.length,
      relations: relations.length
    },
    epochs,
    entities,
    events,
    edges,
    relations,
    conflicts,
    tombstones
  };
}

/** Rollback: copy an older version forward as the new master (append-only). */
export async function rollbackToVersion(worldId: string, version: number) {
  const { mergeWorld } = await import('./merge');
  const world = await requireWorld(worldId);
  if (version === world.masterVersion) {
    throw new GovernanceError('invalid_rollback', 'Target version is already the master');
  }
  return mergeWorld(worldId, { rollbackTo: version });
}
