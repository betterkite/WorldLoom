import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/client';
import { createWorld } from '@/lib/worldbuilding/worlds';
import { submitChange, GovernanceError } from '@/lib/governance/changes';
import { mergeWorld } from '@/lib/governance/merge';

async function cleanDb() {
  await prisma.$transaction([
    prisma.tombstone.deleteMany(),
    prisma.conflictRecord.deleteMany(),
    prisma.worldVersion.deleteMany(),
    prisma.change.deleteMany(),
    prisma.eventEdge.deleteMany(),
    prisma.relationshipEvent.deleteMany(),
    prisma.chronicleEvent.deleteMany(),
    prisma.entity.deleteMany(),
    prisma.epoch.deleteMany(),
    prisma.source.deleteMany(),
    prisma.world.deleteMany()
  ]);
}

/** ISS-21：并发合并必须串行化——一个成功，另一个 nothing_to_merge（409），而非 500。 */
describe('governance: concurrent merge serialization (ISS-21)', () => {
  let worldId: string;

  beforeEach(async () => {
    await cleanDb();
    worldId = (await createWorld({ name: '并发世界', premise: 'p' })).id;
  });

  it('lets exactly one of two parallel merges win and reports nothing_to_merge for the other', async () => {
    const before = (await prisma.world.findUniqueOrThrow({ where: { id: worldId } })).masterVersion;
    await submitChange(worldId, {
      kind: 'entity_upsert',
      payload: {
        kind: 'character',
        name: '并发角色',
        aliases: [],
        summary: '',
        content: '',
        confidence: 'INFERRED',
        tags: [],
        sourceRefs: []
      }
    });

    const settled = await Promise.allSettled([mergeWorld(worldId), mergeWorld(worldId)]);
    const fulfilled = settled.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof mergeWorld>>> =>
        r.status === 'fulfilled'
    );
    const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const error = rejected[0].reason as GovernanceError;
    expect(error).toBeInstanceOf(GovernanceError);
    expect(error.code).toBe('nothing_to_merge');

    const world = await prisma.world.findUniqueOrThrow({ where: { id: worldId } });
    expect(world.masterVersion).toBe(before + 1);
    const pending = await prisma.change.count({ where: { worldId, status: 'pending' } });
    expect(pending).toBe(0);
  });
});
