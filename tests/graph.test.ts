import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/client';
import { createWorld } from '@/lib/worldbuilding/worlds';
import { submitChange } from '@/lib/governance/changes';
import { mergeWorld } from '@/lib/governance/merge';
import { getFocusGraph } from '@/lib/graph/world-graph';

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

const entityPayload = (name: string, kind = 'character') => ({
  kind,
  name,
  aliases: [],
  summary: '',
  content: '',
  confidence: 'INFERRED',
  tags: [],
  sourceRefs: []
});

const stateMap = (graph: {
  edges: { label: string; eventTitle: string | null; stateAt?: 'active' | 'ended' | 'future' }[];
}) => new Map(graph.edges.map((edge) => [`${edge.label}@${edge.eventTitle}`, edge.stateAt]));

/** B-5 时间切片着色：view=relations 的 stateAt ∈ active | ended | future */
describe('graph focus view: relation time-slice states', () => {
  let worldId: string;

  beforeEach(async () => {
    await cleanDb();
    worldId = (await createWorld({ name: '图谱测试世界', premise: '时间切片验证' })).id;
  });

  async function seed() {
    const change = async (kind: string, payload: Record<string, unknown>) => {
      const { change: row } = await submitChange(worldId, { kind, payload } as Parameters<
        typeof submitChange
      >[1]);
      return row.targetUid;
    };
    const e1 = await change('epoch_upsert', { name: '创世纪', order: 0 });
    const e2 = await change('epoch_upsert', { name: '征伐纪', order: 1 });
    const a = await change('entity_upsert', entityPayload('甲'));
    const b = await change('entity_upsert', entityPayload('乙'));
    const f = await change('entity_upsert', entityPayload('守梦人', 'faction'));
    const ev1 = await change('event_upsert', {
      title: '拜师',
      epochUid: e1,
      epochYear: 1,
      participantUids: [a, b]
    });
    const ev2 = await change('event_upsert', {
      title: '结盟',
      epochUid: e1,
      epochYear: 2,
      participantUids: [a, f]
    });
    const ev3 = await change('event_upsert', {
      title: '反目',
      epochUid: e2,
      epochYear: 1,
      participantUids: [a, f]
    });
    await change('relation_upsert', {
      subjectUid: a,
      objectUid: b,
      relation: '师徒',
      polarity: 'establish',
      eventUid: ev1
    });
    await change('relation_upsert', {
      subjectUid: a,
      objectUid: f,
      relation: '盟友',
      polarity: 'establish',
      eventUid: ev2
    });
    await change('relation_upsert', {
      subjectUid: a,
      objectUid: f,
      relation: '盟友',
      polarity: 'terminate',
      eventUid: ev3
    });
    await mergeWorld(worldId);
    return { ev1, ev2, ev3 };
  }

  it('defaults to current state and exposes anchor events', async () => {
    await seed();
    const graph = await getFocusGraph(worldId, 'relations');
    expect(graph.anchorEvents?.length).toBeGreaterThanOrEqual(3);
    expect(graph.asOf).toBeNull();
    const states = stateMap(graph);
    expect(states.get('师徒@拜师')).toBe('active');
    expect(states.get('盟友@结盟')).toBe('active');
    expect(states.get('盟友·终止@反目')).toBe('ended');
  });

  it('classifies active / ended / future as of an anchor event', async () => {
    const { ev1, ev2, ev3 } = await seed();

    const atEv2 = await getFocusGraph(worldId, 'relations', { asOf: ev2 });
    expect(atEv2.asOf?.title).toBe('结盟');
    const m2 = stateMap(atEv2);
    expect(m2.get('师徒@拜师')).toBe('active');
    expect(m2.get('盟友@结盟')).toBe('active');
    expect(m2.get('盟友·终止@反目')).toBe('future');

    const atEv3 = await getFocusGraph(worldId, 'relations', { asOf: ev3 });
    const m3 = stateMap(atEv3);
    expect(m3.get('师徒@拜师')).toBe('active');
    expect(m3.get('盟友@结盟')).toBe('ended');
    expect(m3.get('盟友·终止@反目')).toBe('ended');

    const atEv1 = await getFocusGraph(worldId, 'relations', { asOf: ev1 });
    const m1 = stateMap(atEv1);
    expect(m1.get('盟友@结盟')).toBe('future');
    expect(m1.get('盟友·终止@反目')).toBe('future');
  });
});
