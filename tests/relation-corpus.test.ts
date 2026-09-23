import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/client';
import { createWorld } from '@/lib/worldbuilding/worlds';
import { submitChange } from '@/lib/governance/changes';
import { searchWorld } from '@/lib/retrieval/search';

async function cleanDb() {
  await prisma.$transaction([
    prisma.tombstone.deleteMany(),
    prisma.conflictRecord.deleteMany(),
    prisma.evalRun.deleteMany(),
    prisma.evalCase.deleteMany(),
    prisma.qaRecord.deleteMany(),
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

/** B-6：关系快照必须可被检索召回（词法路径）。 */
describe('retrieval corpus includes relationship snapshots (B-6)', () => {
  let worldId: string;

  beforeEach(async () => {
    await cleanDb();
    worldId = (await createWorld({ name: '关系语料世界', premise: 'p' })).id;
  });

  it('recalls a mentor relation by searching the relation name', async () => {
    const change = async (kind: string, payload: Record<string, unknown>) => {
      const { change: row } = await submitChange(worldId, { kind, payload } as Parameters<
        typeof submitChange
      >[1]);
      return row.targetUid as string;
    };
    const yun = await change('entity_upsert', {
      kind: 'character',
      name: '云隐子',
      aliases: [],
      summary: '断梦派长老',
      content: '',
      confidence: 'INFERRED',
      tags: [],
      sourceRefs: []
    });
    const xiang = await change('entity_upsert', {
      kind: 'character',
      name: '向顶天',
      aliases: [],
      summary: '少年',
      content: '',
      confidence: 'INFERRED',
      tags: [],
      sourceRefs: []
    });
    await mergeSelf(worldId);
    const version = (await prisma.world.findUniqueOrThrow({ where: { id: worldId } }))
      .masterVersion;
    await prisma.relationshipEvent.create({
      data: {
        worldId,
        version,
        uid: 'rel_probe0001',
        subjectUid: yun,
        objectUid: xiang,
        relation: '师徒',
        polarity: 'establish'
      }
    });

    const result = await searchWorld(worldId, '师徒', { useSemantic: false });
    const relationHit = result.hits.find((hit) => hit.kind === 'relation');
    expect(relationHit).toBeDefined();
    expect(relationHit?.name).toContain('云隐子');
    expect(relationHit?.name).toContain('向顶天');
  });
});

async function mergeSelf(worldId: string) {
  const { mergeWorld } = await import('@/lib/governance/merge');
  await mergeWorld(worldId, 'test');
}
