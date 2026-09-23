import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/client';
import { createWorld } from '@/lib/worldbuilding/worlds';
import { commitGenesis, planWorld, type ChatFn } from '@/lib/worldbuilding/genesis';
import type { ChatResult } from '@/lib/llm/client';

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

/** Deterministic fake LLM: replays scripted responses in order. */
function fakeChat(...contents: string[]): ChatFn & { calls: number } {
  let index = 0;
  const fn = async () => {
    const content = contents[Math.min(index, contents.length - 1)];
    index += 1;
    return {
      content,
      profileId: 'fake',
      model: 'fake-model',
      usage: null,
      latencyMs: 1
    } satisfies ChatResult;
  };
  fn.calls = 0;
  return new Proxy(fn, {
    apply(target, thisArg, args) {
      (target as { calls: number }).calls = (target as { calls: number }).calls + 1;
      return Reflect.apply(target, thisArg, args);
    }
  }) as ChatFn & { calls: number };
}

const PLAN_JSON = JSON.stringify({
  premiseExpanded: '修行者以梦为舟，渡人间执念。',
  tone: '苍凉厚重',
  epochs: [
    { name: '蒙昧纪', description: '梦术初现' },
    { name: '渡梦纪', description: '梦舟盛行' }
  ],
  factions: [{ name: '守梦人', summary: '守护梦界秩序' }],
  regions: [{ name: '枯井原', summary: '大地裂隙所在' }],
  threads: ['向顶天的渡梦之旅']
});

const WORLD_JSON = JSON.stringify({
  epochs: [
    { name: '蒙昧纪', order: 0, description: '梦术初现' },
    { name: '渡梦纪', order: 1, description: '梦舟盛行' }
  ],
  entities: [
    {
      kind: 'character',
      name: '向顶天',
      aliases: [],
      summary: '求道者',
      content: '在枯井底得残书。',
      confidence: 'EXTRACTED',
      tags: ['主角']
    },
    {
      kind: 'location',
      name: '枯井原',
      aliases: [],
      summary: '大地裂隙',
      content: '',
      confidence: 'INFERRED',
      tags: []
    },
    {
      kind: 'organization',
      name: '守梦人',
      aliases: [],
      summary: '守护梦界秩序',
      content: '',
      confidence: 'INFERRED',
      tags: []
    }
  ],
  events: [
    {
      title: '枯井得书',
      summary: '得半卷残书',
      content: '',
      epochName: '蒙昧纪',
      year: 998,
      participants: ['向顶天'],
      location: '枯井原',
      causes: [],
      confidence: 'EXTRACTED'
    },
    {
      title: '初入梦界',
      summary: '第一次渡梦',
      content: '',
      epochName: '渡梦纪',
      year: 3,
      participants: ['向顶天'],
      location: null,
      causes: ['枯井得书'],
      confidence: 'INFERRED'
    }
  ],
  relations: [
    {
      subject: '向顶天',
      object: '守梦人',
      relation: 'rival',
      polarity: 'establish',
      eventName: '初入梦界'
    },
    {
      subject: '向顶天',
      object: '不存在的组织',
      relation: 'ally',
      polarity: 'establish',
      eventName: null
    }
  ]
});

describe('genesis & compiler (fake LLM, real DB)', () => {
  let worldId: string;

  beforeEach(async () => {
    await cleanDb();
    const world = await createWorld({ name: '梦舟世界', premise: '修行者以梦为舟' });
    worldId = world.id;
  });

  it('planWorld parses a valid framework preview', async () => {
    const plan = await planWorld(fakeChat(PLAN_JSON), {
      name: '梦舟世界',
      premise: '修行者以梦为舟',
      style: ''
    });
    expect(plan.epochs).toHaveLength(2);
    expect(plan.factions[0].name).toBe('守梦人');
    expect(plan.tone).toBe('苍凉厚重');
  });

  it('planWorld rejects malformed LLM output with a readable error', async () => {
    await expect(
      planWorld(fakeChat('这不是 JSON'), { name: 'x', premise: 'y', style: '' })
    ).rejects.toThrow(/no JSON/); // salvage 语义：不可修复的垃圾输出报 "no JSON"，可修复的截断被修复
  });

  it('commitGenesis stages a batch with names resolved to uids and defects for unknown names', async () => {
    const result = await commitGenesis(
      fakeChat(WORLD_JSON),
      worldId,
      { name: '梦舟世界', premise: 'p', style: '' },
      JSON.parse(PLAN_JSON)
    );

    expect(result.staged).toBeGreaterThan(8);
    expect(result.defects.some((d) => d.reason.includes('不存在的组织'))).toBe(true);

    // everything shares one batch and stays pending (review mode)
    const changes = await prisma.change.findMany({ where: { worldId } });
    expect(changes.length).toBe(result.staged);
    expect(new Set(changes.map((c) => c.batchId))).toEqual(new Set([result.batchId]));
    expect(changes.every((c) => c.status === 'pending' && c.author === 'genesis')).toBe(true);

    // name resolution: events reference the generated epoch uid, participants the entity uid
    await mergeAll(worldId);
    const events = await prisma.chronicleEvent.findMany({ where: { worldId, version: 2 } });
    const epochs = await prisma.epoch.findMany({ where: { worldId, version: 2 } });
    const entities = await prisma.entity.findMany({ where: { worldId, version: 2 } });
    expect(events).toHaveLength(2);
    const epochUidByName = new Map(epochs.map((e) => [e.name, e.uid]));
    for (const event of events) {
      expect(event.epochUid).toBe(
        epochUidByName.get(event.epochUid === epochUidByName.get('蒙昧纪') ? '蒙昧纪' : '渡梦纪')
      );
    }
    const xiang = entities.find((e) => e.name === '向顶天');
    expect(events.every((e) => e.participantUids.includes(xiang!.uid))).toBe(true);

    // causal edge: 枯井得书 → 初入梦界
    const edges = await prisma.eventEdge.findMany({ where: { worldId, version: 2 } });
    expect(edges).toHaveLength(1);

    // relation with unknown object was dropped; known one staged
    const relations = await prisma.relationshipEvent.findMany({ where: { worldId, version: 2 } });
    expect(relations).toHaveLength(1);
    expect(relations[0].relation).toBe('rival');
  });
});

async function mergeAll(worldId: string) {
  const { mergeWorld } = await import('@/lib/governance/merge');
  await mergeWorld(worldId, 'test');
}
