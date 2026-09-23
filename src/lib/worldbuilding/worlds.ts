import { prisma } from '@/lib/db/client';
import { GovernanceError } from '@/lib/governance/changes';

interface WorldRow {
  id: string;
  name: string;
  premise: string;
  style: string;
  masterVersion: number;
  ingestMode: string;
  createdAt: Date;
  updatedAt: Date;
  pending: bigint;
  entities: bigint;
  events: bigint;
}

export async function createWorld(input: {
  name: string;
  premise?: string;
  style?: string;
  ingestMode?: string;
}) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new GovernanceError('invalid_world', 'World name is required');
  const ingestMode = input.ingestMode === 'auto' ? 'auto' : 'review';
  return prisma.world.create({
    data: {
      name,
      premise: input.premise ?? '',
      style: input.style ?? '',
      ingestMode,
      versions: {
        create: { version: 1, summary: '世界初始版本（空）' }
      }
    }
  });
}

export async function listWorlds() {
  const rows = await prisma.$queryRaw<WorldRow[]>`
    SELECT w.id, w.name, w.premise, w.style, w."masterVersion", w."ingestMode",
           w."createdAt", w."updatedAt",
           (SELECT COUNT(*) FROM changes c WHERE c."worldId" = w.id AND c.status = 'pending') AS pending,
           (SELECT COUNT(*) FROM entities e WHERE e."worldId" = w.id AND e.version = w."masterVersion") AS entities,
           (SELECT COUNT(*) FROM chronicle_events c WHERE c."worldId" = w.id AND c.version = w."masterVersion") AS events
    FROM worlds w
    ORDER BY w."updatedAt" DESC`;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    premise: row.premise,
    style: row.style,
    masterVersion: row.masterVersion,
    ingestMode: row.ingestMode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    pendingChanges: Number(row.pending),
    entityCount: Number(row.entities),
    eventCount: Number(row.events)
  }));
}

export async function getWorld(worldId: string) {
  const world = await prisma.world.findUnique({ where: { id: worldId } });
  if (!world) throw new GovernanceError('world_not_found', 'World not found');
  const [pendingChanges, versionCount] = await Promise.all([
    prisma.change.count({ where: { worldId, status: 'pending' } }),
    prisma.worldVersion.count({ where: { worldId } })
  ]);
  const [entities, events, epochs] = await Promise.all([
    prisma.entity.count({ where: { worldId, version: world.masterVersion } }),
    prisma.chronicleEvent.count({ where: { worldId, version: world.masterVersion } }),
    prisma.epoch.count({ where: { worldId, version: world.masterVersion } })
  ]);
  return { ...world, pendingChanges, versionCount, master: { entities, events, epochs } };
}

export async function updateWorld(
  worldId: string,
  input: {
    name?: string;
    premise?: string;
    style?: string;
    ingestMode?: string;
    calendarJson?: string;
  }
) {
  await getWorld(worldId);
  if (input.ingestMode !== undefined && !['review', 'auto'].includes(input.ingestMode)) {
    throw new GovernanceError('invalid_world', 'ingestMode must be review or auto');
  }
  return prisma.world.update({
    where: { id: worldId },
    data: {
      ...(input.name !== undefined ? { name: String(input.name).trim() || undefined } : {}),
      ...(input.premise !== undefined ? { premise: input.premise } : {}),
      ...(input.style !== undefined ? { style: input.style } : {}),
      ...(input.ingestMode !== undefined ? { ingestMode: input.ingestMode } : {}),
      ...(input.calendarJson !== undefined ? { calendarJson: input.calendarJson } : {})
    }
  });
}

export async function deleteWorld(worldId: string) {
  const world = await getWorld(worldId);
  await prisma.world.delete({ where: { id: worldId } });
  return { id: worldId, name: world.name, deleted: true };
}
