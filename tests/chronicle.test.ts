import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/client';
import { createWorld } from '@/lib/worldbuilding/worlds';
import { submitChange } from '@/lib/governance/changes';
import { mergeWorld } from '@/lib/governance/merge';
import { runLint, listLintFindings, updateLintFinding } from '@/lib/governance/lint';
import { getRelationsAt } from '@/lib/worldbuilding/relations';

async function cleanDb() {
  await prisma.$transaction([
    prisma.lintFinding.deleteMany(),
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

async function setupWorld() {
  const world = await createWorld({ name: '编年史测试世界' });
  return world.id;
}

const entity = (name: string, kind = 'character') => ({
  kind,
  name,
  aliases: [],
  summary: '',
  content: '',
  confidence: 'INFERRED',
  tags: [],
  sourceRefs: []
});

const event = (
  title: string,
  epochUid: string,
  year: number,
  extra: Record<string, unknown> = {}
) => ({
  title,
  summary: '',
  content: '',
  epochUid,
  epochYear: year,
  fictionPrecision: 'year',
  locationUid: null,
  participantUids: [],
  confidence: 'INFERRED',
  causeUids: [],
  effectUids: [],
  ...extra
});

async function findUid(worldId: string, prefix: string, name: string): Promise<string> {
  const pendingCount = await prisma.change.count({ where: { worldId, status: 'pending' } });
  if (pendingCount > 0) await mergeWorld(worldId, 'setup');
  const version = (await prisma.world.findUniqueOrThrow({ where: { id: worldId } })).masterVersion;
  const rows =
    prefix === 'epo'
      ? await prisma.epoch.findMany({ where: { worldId, version } })
      : prefix === 'evt'
        ? await prisma.chronicleEvent.findMany({ where: { worldId, version } })
        : await prisma.entity.findMany({ where: { worldId, version } });
  const match = rows.find((row) => ('name' in row ? row.name : row.title) === name);
  if (!match) throw new Error(`fixture missing: ${name}`);
  return match.uid;
}

describe('chronicle lint (Phase 3)', () => {
  let worldId: string;

  beforeEach(async () => {
    await cleanDb();
    worldId = await setupWorld();
  });

  it('flags causal inversion after a date shift', async () => {
    await submitChange(worldId, { kind: 'epoch_upsert', payload: { name: '主纪', order: 0 } });
    await mergeWorld(worldId);
    const epochUid = await findUid(worldId, 'epo', '主纪');

    await submitChange(worldId, { kind: 'event_upsert', payload: event('起因', epochUid, 1) });
    await submitChange(worldId, {
      kind: 'event_upsert',
      payload: { ...event('结果', epochUid, 2), causeUids: [] }
    });
    await mergeWorld(worldId);
    const [causeUid, effectUid] = await Promise.all([
      findUid(worldId, 'evt', '起因'),
      findUid(worldId, 'evt', '结果')
    ]);
    // wire the edge via an event update carrying its cause
    await submitChange(worldId, {
      kind: 'event_upsert',
      targetUid: effectUid,
      payload: { ...event('结果', epochUid, 2), causeUids: [causeUid] }
    });
    await mergeWorld(worldId);
    expect((await runLint(worldId)).counts.error).toBe(0);

    // THE acceptance move: shift the cause's date past its effect
    // (a realistic edit carries its edges — explicit arrays rebuild them)
    await submitChange(worldId, {
      kind: 'event_upsert',
      targetUid: causeUid,
      payload: { ...event('起因', epochUid, 9), causeUids: [], effectUids: [effectUid] }
    });
    await mergeWorld(worldId);

    const result = await runLint(worldId);
    expect(result.counts.error).toBe(1);
    const inversion = result.findings.find((f) => f.rule === 'causal_inversion');
    expect(inversion).toBeDefined();
    expect(inversion!.message).toContain('因果倒置');
  });

  it('detects dangling references, orphan events and epoch gaps', async () => {
    await submitChange(worldId, { kind: 'epoch_upsert', payload: { name: '空纪元', order: 1 } });
    await submitChange(worldId, { kind: 'epoch_upsert', payload: { name: '独居纪元', order: 2 } });
    await mergeWorld(worldId);
    const epochUid = await findUid(worldId, 'epo', '空纪元');
    // merge validates epoch existence but NOT entity references — those reach
    // master and must be caught by lint (defence in depth)
    await submitChange(worldId, {
      kind: 'event_upsert',
      payload: { ...event('悬空地点', epochUid, 1), locationUid: 'ent_missing' }
    });
    await submitChange(worldId, { kind: 'event_upsert', payload: event('孤儿事件', epochUid, 2) });
    await mergeWorld(worldId);

    const { findings } = await runLint(worldId);
    const rules = findings.filter((f) => f.status === 'open').map((f) => f.rule);
    expect(rules).toContain('dangling_reference');
    expect(rules).toContain('orphan_event');
    expect(rules).toContain('epoch_gap');
  });

  it('flags dead participants appearing after their death (heuristic)', async () => {
    await submitChange(worldId, { kind: 'epoch_upsert', payload: { name: '纪', order: 0 } });
    await submitChange(worldId, { kind: 'entity_upsert', payload: entity('甲') });
    await mergeWorld(worldId);
    const epochUid = await findUid(worldId, 'epo', '纪');
    const jia = await findUid(worldId, 'ent', '甲');

    await submitChange(worldId, {
      kind: 'event_upsert',
      payload: event('甲的早年', epochUid, 1, { participantUids: [jia] })
    });
    await submitChange(worldId, {
      kind: 'event_upsert',
      payload: event('甲之死', epochUid, 2, { participantUids: [jia] })
    });
    await submitChange(worldId, {
      kind: 'event_upsert',
      payload: event('甲的葬礼后宴席', epochUid, 5, { participantUids: [jia] })
    });
    await mergeWorld(worldId);

    const { findings } = await runLint(worldId);
    const dead = findings.filter((f) => f.rule === 'dead_participant');
    expect(dead).toHaveLength(1);
    expect(dead[0].message).toContain('甲的葬礼后宴席');
  });

  it('flags duplicate names and self relations', async () => {
    await submitChange(worldId, { kind: 'entity_upsert', payload: entity('同名人') });
    await submitChange(worldId, { kind: 'entity_upsert', payload: entity('同名人') });
    await mergeWorld(worldId);
    const uid = await findUid(worldId, 'ent', '同名人');
    await submitChange(worldId, {
      kind: 'relation_upsert',
      payload: {
        subjectUid: uid,
        objectUid: uid,
        relation: 'ally',
        polarity: 'establish',
        note: '',
        eventUid: null
      }
    });
    await mergeWorld(worldId);

    const { findings } = await runLint(worldId);
    expect(findings.filter((f) => f.rule === 'duplicate_name')).toHaveLength(1);
    expect(findings.filter((f) => f.rule === 'self_relation')).toHaveLength(1);
  });

  it('preserves ignored findings and marks vanished ones fixed on re-run', async () => {
    await submitChange(worldId, {
      kind: 'epoch_upsert',
      payload: { name: '无事件纪元', order: 0 }
    });
    await mergeWorld(worldId);
    const first = await runLint(worldId);
    expect(first.counts.warning).toBeGreaterThanOrEqual(1);

    const finding = await listLintFindings(worldId, 'open');
    await updateLintFinding(worldId, finding[0].id, 'ignored');

    const rerun = await runLint(worldId);
    const same = rerun.findings.find((f) => f.fingerprint === finding[0].fingerprint);
    expect(same?.status).toBe('ignored'); // ignored survives same-version re-run

    // fix the condition: add an event to the epoch, advance the master —
    // the historical finding is superseded to 'fixed'
    const epochUid = await findUid(worldId, 'epo', '无事件纪元');
    await submitChange(worldId, {
      kind: 'event_upsert',
      payload: event('填补事件', epochUid, 1, { participantUids: [], locationUid: null })
    });
    await mergeWorld(worldId);

    await runLint(worldId);
    const original = await prisma.lintFinding.findUniqueOrThrow({ where: { id: finding[0].id } });
    expect(original.status).toBe('fixed');
  });
});

describe('relationship time-slicing (Phase 3)', () => {
  let worldId: string;
  let jia: string;
  let yi: string;
  let e1: string;
  let e2: string;

  beforeEach(async () => {
    await cleanDb();
    worldId = await setupWorld();
    await submitChange(worldId, { kind: 'epoch_upsert', payload: { name: '纪', order: 0 } });
    await mergeWorld(worldId);
    const epochUid = await findUid(worldId, 'epo', '纪');
    jia = (await (async () => {
      await submitChange(worldId, { kind: 'entity_upsert', payload: entity('甲') });
      await mergeWorld(worldId);
      return findUid(worldId, 'ent', '甲');
    })()) as string;
    yi = (await (async () => {
      await submitChange(worldId, { kind: 'entity_upsert', payload: entity('乙') });
      await mergeWorld(worldId);
      return findUid(worldId, 'ent', '乙');
    })()) as string;

    await submitChange(worldId, {
      kind: 'event_upsert',
      payload: event('结盟', epochUid, 1, { participantUids: [jia, yi] })
    });
    await submitChange(worldId, {
      kind: 'event_upsert',
      payload: event('反目', epochUid, 3, { participantUids: [jia, yi] })
    });
    await mergeWorld(worldId);
    e1 = await findUid(worldId, 'evt', '结盟');
    e2 = await findUid(worldId, 'evt', '反目');
  });

  it('folds relations as of an event: ally at E1, terminated after E2', async () => {
    // foundational ally (no anchor) + terminate anchored at 反目 (E2)
    await submitChange(worldId, {
      kind: 'relation_upsert',
      payload: {
        subjectUid: jia,
        objectUid: yi,
        relation: 'ally',
        polarity: 'establish',
        note: '',
        eventUid: null
      }
    });
    await mergeWorld(worldId);
    await submitChange(worldId, {
      kind: 'relation_upsert',
      payload: {
        subjectUid: jia,
        objectUid: yi,
        relation: 'ally',
        polarity: 'terminate',
        note: '决裂',
        eventUid: e2
      }
    });
    await mergeWorld(worldId);

    const atE1 = await getRelationsAt(worldId, { atEventUid: e1 });
    expect(atE1.asOf.title).toBe('结盟');
    expect(atE1.edges.filter((edge) => edge.relation === 'ally')).toHaveLength(1);
    expect(atE1.edges.find((edge) => edge.relation === 'ally')?.active).toBe(true);

    const atE2 = await getRelationsAt(worldId, { atEventUid: e2 });
    const ally = atE2.edges.find((edge) => edge.relation === 'ally');
    expect(ally?.active).toBe(false);
    expect(atE2.counts.terminated).toBe(1);

    const current = await getRelationsAt(worldId, {});
    expect(current.edges.find((edge) => edge.relation === 'ally')?.active).toBe(false);
  });

  it('resolves names and counts foundational edges', async () => {
    await submitChange(worldId, {
      kind: 'relation_upsert',
      payload: {
        subjectUid: jia,
        objectUid: yi,
        relation: 'kin',
        polarity: 'establish',
        note: '',
        eventUid: null
      }
    });
    await mergeWorld(worldId);

    const result = await getRelationsAt(worldId, {});
    const kin = result.edges.find((edge) => edge.relation === 'kin');
    expect(kin?.subjectName).toBe('甲');
    expect(kin?.objectName).toBe('乙');
    expect(kin?.active).toBe(true);
    expect(result.counts.foundational).toBeGreaterThanOrEqual(1);
  });
});
