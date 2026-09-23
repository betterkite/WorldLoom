import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/client';
import { createWorld } from '@/lib/worldbuilding/worlds';
import { submitChange, updatePendingChange, GovernanceError } from '@/lib/governance/changes';
import { mergeWorld } from '@/lib/governance/merge';
import { listEntities, listEvents, listEpochs } from '@/lib/worldbuilding/content';
import { rollbackToVersion, getVersionSnapshot } from '@/lib/governance/versions';

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

const entityPayload = (name: string, extra: Record<string, unknown> = {}) => ({
  kind: 'character',
  name,
  aliases: [],
  summary: '',
  content: '',
  confidence: 'INFERRED',
  tags: [],
  sourceRefs: [],
  ...extra
});

describe('governance: Change → merge → immutable version', () => {
  let worldId: string;

  beforeEach(async () => {
    await cleanDb();
    const world = await createWorld({ name: '测试世界', premise: '一个用于测试的世界' });
    worldId = world.id;
  });

  it('creates a world at v1 and merges an entity change into v2', async () => {
    const world = await prisma.world.findUniqueOrThrow({ where: { id: worldId } });
    expect(world.masterVersion).toBe(1);

    const { change, merged } = await submitChange(worldId, {
      kind: 'entity_upsert',
      payload: entityPayload('林昭')
    });
    expect(change.status).toBe('pending');
    expect(change.targetUid).toMatch(/^ent_/);
    expect(merged).toBeNull(); // review mode: no auto merge

    const result = await mergeWorld(worldId, '首个条目');
    expect(result.version).toBe(2);
    expect(result.changeCount).toBe(1);

    const master = await listEntities(worldId);
    expect(master).toHaveLength(1);
    expect(master[0].name).toBe('林昭');
    expect(master[0].version).toBe(2);

    // v1 remains empty and immutable
    const v1 = await getVersionSnapshot(worldId, 1);
    expect(v1.entities).toHaveLength(0);
  });

  it('keeps old versions immutable when later merges change content', async () => {
    const { change } = await submitChange(worldId, {
      kind: 'entity_upsert',
      payload: entityPayload('苏折雪')
    });
    await mergeWorld(worldId);
    const uid = change.targetUid as string;

    await submitChange(worldId, {
      kind: 'entity_upsert',
      targetUid: uid,
      payload: entityPayload('苏折雪·改')
    });
    await mergeWorld(worldId);

    const master = await listEntities(worldId);
    expect(master[0].name).toBe('苏折雪·改');

    const v2 = await getVersionSnapshot(worldId, 2);
    expect(v2.entities[0].name).toBe('苏折雪'); // history untouched
  });

  it('records concurrent_target conflict and the latest change wins', async () => {
    const { change } = await submitChange(worldId, {
      kind: 'entity_upsert',
      payload: entityPayload('重复目标')
    });
    await mergeWorld(worldId);
    const uid = change.targetUid as string;

    await submitChange(worldId, {
      kind: 'entity_upsert',
      targetUid: uid,
      payload: entityPayload('第一版')
    });
    await submitChange(worldId, {
      kind: 'entity_upsert',
      targetUid: uid,
      payload: entityPayload('第二版')
    });
    const result = await mergeWorld(worldId);

    expect(result.conflictCount).toBe(1);
    const snapshot = await getVersionSnapshot(worldId, result.version);
    expect(snapshot.conflicts).toHaveLength(1);
    expect(snapshot.conflicts[0].reason).toBe('concurrent_target');
    expect(snapshot.entities[0].name).toBe('第二版'); // latest submitted wins
  });

  it('deduplicates identical same-target re-submissions without a conflict', async () => {
    const { change } = await submitChange(worldId, {
      kind: 'entity_upsert',
      payload: entityPayload('杨过')
    });
    await mergeWorld(worldId);
    const uid = change.targetUid as string;

    // 真实场景：多个章节各自编译出同一角色的相同 upsert
    await submitChange(worldId, {
      kind: 'entity_upsert',
      targetUid: uid,
      payload: entityPayload('杨过')
    });
    await submitChange(worldId, {
      kind: 'entity_upsert',
      targetUid: uid,
      payload: entityPayload('杨过')
    });
    const result = await mergeWorld(worldId);

    expect(result.conflictCount).toBe(0);
    const snapshot = await getVersionSnapshot(worldId, result.version);
    expect(snapshot.conflicts).toHaveLength(0);
    expect(snapshot.entities.find((e) => e.uid === uid)?.name).toBe('杨过');
    // 三条变更全部进入 merged 终态（含被去重的两条）
    const merged = await prisma.change.count({ where: { worldId, status: 'merged' } });
    expect(merged).toBe(3);
  });

  it('records stale_base_version conflict', async () => {
    await submitChange(worldId, { kind: 'entity_upsert', payload: entityPayload('既有') });
    await mergeWorld(worldId); // master = 2

    const { change } = await submitChange(worldId, {
      kind: 'entity_upsert',
      payload: entityPayload('晚到')
    });
    // simulate an editor who staged against v1
    await prisma.change.update({ where: { id: change.id }, data: { baseVersion: 1 } });
    const result = await mergeWorld(worldId);

    expect(result.conflictCount).toBe(1);
    const snapshot = await getVersionSnapshot(worldId, result.version);
    expect(snapshot.conflicts[0].reason).toBe('stale_base_version');
  });

  it('deletes leave tombstones and the uid can be recreated', async () => {
    const { change } = await submitChange(worldId, {
      kind: 'entity_upsert',
      payload: entityPayload('将死')
    });
    await mergeWorld(worldId);
    const uid = change.targetUid as string;

    await submitChange(worldId, { kind: 'entity_delete', targetUid: uid });
    await mergeWorld(worldId);
    expect(await listEntities(worldId)).toHaveLength(0);
    const v3 = await getVersionSnapshot(worldId, 3);
    expect(v3.tombstones).toHaveLength(1);

    // recreate the same uid — tombstone is cleared
    await submitChange(worldId, {
      kind: 'entity_upsert',
      targetUid: uid,
      payload: entityPayload('重生')
    });
    await mergeWorld(worldId);
    const master = await listEntities(worldId);
    expect(master).toHaveLength(1);
    const v4 = await getVersionSnapshot(worldId, 4);
    expect(v4.tombstones).toHaveLength(0);
  });

  it('rolls back by copying an older version forward (append-only)', async () => {
    const { change } = await submitChange(worldId, {
      kind: 'entity_upsert',
      payload: entityPayload('原初')
    });
    await mergeWorld(worldId); // v2
    const uid = change.targetUid as string;
    await submitChange(worldId, {
      kind: 'entity_upsert',
      targetUid: uid,
      payload: entityPayload('被污染')
    });
    await mergeWorld(worldId); // v3

    const result = await rollbackToVersion(worldId, 2);
    expect(result.version).toBe(4);
    expect(await listEntities(worldId).then((rows) => rows[0].name)).toBe('原初');

    // v3 still shows the polluted state (history intact)
    const v3 = await getVersionSnapshot(worldId, 3);
    expect(v3.entities[0].name).toBe('被污染');
  });

  it('derives chronological sort order from epoch + year', async () => {
    await submitChange(worldId, { kind: 'epoch_upsert', payload: { name: '旧纪', order: 0 } });
    await submitChange(worldId, { kind: 'epoch_upsert', payload: { name: '新纪', order: 1 } });
    await mergeWorld(worldId);
    const epochs = await listEpochs(worldId);
    const [oldEra, newEra] = epochs;

    await submitChange(worldId, {
      kind: 'event_upsert',
      payload: { title: '新纪事件', epochUid: newEra.uid, epochYear: 3 }
    });
    await submitChange(worldId, {
      kind: 'event_upsert',
      payload: { title: '旧纪事件', epochUid: oldEra.uid, epochYear: 99 }
    });
    await mergeWorld(worldId);

    const events = await listEvents(worldId);
    expect(events.map((e) => e.title)).toEqual(['旧纪事件', '新纪事件']); // epoch order dominates year
    expect(events[0].sortOrder).toBeLessThan(events[1].sortOrder);
  });

  it('rejects an event referencing an unknown epoch (transaction rolls back)', async () => {
    await submitChange(worldId, {
      kind: 'event_upsert',
      payload: { title: '悬空事件', epochUid: 'epo_missing', epochYear: 1 }
    });
    await expect(mergeWorld(worldId)).rejects.toMatchObject({ code: 'unknown_epoch' });
    const world = await prisma.world.findUniqueOrThrow({ where: { id: worldId } });
    expect(world.masterVersion).toBe(1); // no partial version created
  });

  it('guards pending changes: optimistic revision and immutability after merge', async () => {
    const { change } = await submitChange(worldId, {
      kind: 'entity_upsert',
      payload: entityPayload('草稿')
    });
    const originalCandidate = change.payload;
    expect(change.candidatePayload).toEqual(originalCandidate);

    await updatePendingChange(worldId, change.id, {
      payload: entityPayload('草稿·修订'),
      expectedRevision: 1
    });
    const edited = await prisma.change.findUniqueOrThrow({ where: { id: change.id } });
    expect(edited.payload).not.toEqual(originalCandidate);
    expect(edited.candidatePayload).toEqual(originalCandidate);
    await expect(
      updatePendingChange(worldId, change.id, {
        payload: entityPayload('并发修改'),
        expectedRevision: 1
      })
    ).rejects.toMatchObject({ code: 'revision_conflict' });

    await mergeWorld(worldId);
    await expect(
      updatePendingChange(worldId, change.id, { payload: entityPayload('再改') })
    ).rejects.toMatchObject({ code: 'change_immutable' });
    await expect(mergeWorld(worldId)).rejects.toMatchObject({ code: 'nothing_to_merge' });
  });

  it('auto mode merges when pending changes reach the batch threshold', async () => {
    const auto = await createWorld({ name: '自动世界', ingestMode: 'auto' });
    await submitChange(auto.id, { kind: 'entity_upsert', payload: entityPayload('甲') });
    await submitChange(auto.id, { kind: 'entity_upsert', payload: entityPayload('乙') });
    const { merged } = await submitChange(auto.id, {
      kind: 'entity_upsert',
      payload: entityPayload('丙')
    });
    expect(merged).not.toBeNull();
    expect(merged!.changeCount).toBe(3);
    expect((await listEntities(auto.id)).length).toBe(3);
  });

  it('throws GovernanceError with world_not_found for missing worlds', async () => {
    await expect(
      submitChange('world_missing', { kind: 'entity_upsert', payload: entityPayload('x') })
    ).rejects.toMatchObject({ code: 'world_not_found' });
    expect(new GovernanceError('test', 'msg').code).toBe('test');
  });
});
