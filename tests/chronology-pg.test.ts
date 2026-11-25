import { randomUUID } from 'node:crypto';
import type { ChangeKind } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/client';
import { createWorld } from '@/lib/worldbuilding/worlds';
import { submitChange } from '@/lib/governance/changes';
import { mergeWorld } from '@/lib/governance/merge';
import { getVersionSnapshot, rollbackToVersion } from '@/lib/governance/versions';
import { getTimeline } from '@/lib/worldbuilding/timeline';
import { getRelationsAt } from '@/lib/worldbuilding/relations';
import { getFocusGraph } from '@/lib/graph/world-graph';
import { runLint } from '@/lib/governance/lint';
import {
  acceptContinuation,
  buildWorldStateSummary,
  generateContinuations
} from '@/lib/worldbuilding/continuation';
import { getManuscriptSummary } from '@/lib/worldbuilding/manuscript-summary';
import { advanceCursorToLatest, createManuscript, setCursor } from '@/lib/worldbuilding/manuscript';
import { listEvents } from '@/lib/worldbuilding/content';
import { buildGameBundle } from '@/lib/export/game-json';
import { exportWorldZip } from '@/lib/export/obsidian';
import { readZip } from '@/lib/export/zip';
import { NextRequest } from 'next/server';
import { GET as graphRequest } from '@/app/api/worlds/[worldId]/graph/route';
import { GET as relationsRequest } from '@/app/api/worlds/[worldId]/relations/route';

// Tests exercise real isolated SQL and governance; inference is never a dependency.
vi.mock('@/lib/retrieval/search', () => ({
  enqueueSemanticIndex: vi.fn(async () => null),
  runSemanticIndexJob: vi.fn(),
  searchWorld: vi.fn()
}));
let worldId: string;
beforeEach(async () => {
  worldId = (await createWorld({ name: `Chronology ${randomUUID()}`, ingestMode: 'review' })).id;
});
afterEach(async () => {
  await prisma.world.deleteMany({ where: { id: worldId } });
});
const event = (title: string, month: number, day: number, extra = {}) => ({
  title,
  epochUid: 'epo_test',
  epochYear: 3,
  epochMonth: month,
  epochDay: day,
  fictionPrecision: 'day',
  participantUids: ['ent_a', 'ent_b'],
  ...extra
});
async function stage(kind: ChangeKind, targetUid: string, payload: unknown) {
  return submitChange(worldId, { kind, targetUid, payload });
}
async function seed() {
  await stage('epoch_upsert', 'epo_test', { name: '灯历', order: 0 });
  await stage('entity_upsert', 'ent_a', { kind: 'character', name: '甲' });
  await stage('entity_upsert', 'ent_b', { kind: 'character', name: '乙' });
  // Later date first; deliberately reversed causality.
  await stage('event_upsert', 'evt_late', event('二月事件', 2, 9, { effectUids: ['evt_early'] }));
  await stage('event_upsert', 'evt_early', event('一月事件', 1, 2, { causeUids: ['evt_late'] }));
  await stage('relation_upsert', 'rel_begin', {
    eventUid: 'evt_early',
    subjectUid: 'ent_a',
    objectUid: 'ent_b',
    relation: '协作',
    polarity: 'establish'
  });
  await stage('relation_upsert', 'rel_end', {
    eventUid: 'evt_late',
    subjectUid: 'ent_a',
    objectUid: 'ent_b',
    relation: '协作',
    polarity: 'terminate'
  });
  return mergeWorld(worldId);
}

describe('complete fiction dates across versioned modules (owned PostgreSQL)', () => {
  it('keeps review pending, then agrees on timeline, slices, graph, lint, export and continuation', async () => {
    await seed();
    const timeline = await getTimeline(worldId);
    expect(timeline.segments.flatMap((segment) => segment.events).map((row) => row.uid)).toEqual([
      'evt_early',
      'evt_late'
    ]);
    expect((await getRelationsAt(worldId, { atEventUid: 'evt_early' })).edges[0]).toMatchObject({
      active: true,
      ambiguous: false
    });
    expect((await getRelationsAt(worldId, { atEventUid: 'evt_late' })).edges[0].active).toBe(false);
    const graph = await getFocusGraph(worldId, 'relations', { asOf: 'evt_early' });
    expect(graph.edges.find((edge) => edge.id === 'rel_end')).toMatchObject({ stateAt: 'future' });
    expect(
      (await runLint(worldId)).findings.some((finding) => finding.rule === 'causal_inversion')
    ).toBe(true);
    expect((await listEvents(worldId)).map((row) => row.uid)).toEqual(['evt_early', 'evt_late']);
    expect((await buildGameBundle(worldId)).events.map((row) => row.uid)).toEqual([
      'evt_early',
      'evt_late'
    ]);
    const vault = readZip((await exportWorldZip(worldId)).buffer);
    const exportedTimeline = vault.find((file) => file.path === 'timeline.md')!.content;
    expect(exportedTimeline.indexOf('一月事件')).toBeLessThan(exportedTimeline.indexOf('二月事件'));
    const manuscript = await createManuscript(worldId, { title: '光标' });
    await setCursor(worldId, manuscript.id, 'evt_early');
    const state = await buildWorldStateSummary(worldId, manuscript.id);
    expect(state.summaryText).toContain('一月事件');
    expect(state.summaryText).not.toContain('二月事件');
    expect((await advanceCursorToLatest(worldId, manuscript.id)).cursorEventUid).toBe('evt_late');
    expect(await prisma.compileRun.count({ where: { worldId } })).toBe(0);
  });

  it('represents same-day conflicting relations as uncertain and does not invent inverted causality', async () => {
    await seed();
    await stage('event_upsert', 'evt_late', event('同日事件', 1, 2, { effectUids: ['evt_early'] }));
    await mergeWorld(worldId);
    const slice = await getRelationsAt(worldId, { atEventUid: 'evt_early' });
    expect(slice.edges[0]).toMatchObject({ active: null, ambiguous: true });
    expect(slice.edges[0].sourceRelationUids).toEqual(['rel_begin', 'rel_end']);
    expect(slice.counts.ambiguous).toBe(1);
    expect(
      (await runLint(worldId)).findings.filter(
        (finding) => finding.status === 'open' && finding.rule === 'causal_inversion'
      )
    ).toHaveLength(0);
  });

  it('keeps the generation anchor when the creator moves the cursor during the response', async () => {
    await seed();
    const manuscript = await createManuscript(worldId, { title: '生成中移动光标' });
    await setCursor(worldId, manuscript.id, 'evt_early');
    const generated = await generateContinuations(
      worldId,
      async (request) => {
        expect(JSON.stringify(request.messages)).toContain('一月事件');
        expect(JSON.stringify(request.messages)).not.toContain('二月事件');
        await setCursor(worldId, manuscript.id, 'evt_late');
        return {
          content: JSON.stringify({
            candidates: [
              {
                kind: 'event_suggestion',
                title: '一月之后',
                summary: '早期事件的后续',
                epochName: '灯历',
                year: 4,
                participants: [],
                relation: null,
                rationale: '以一月事件为依据'
              }
            ]
          }),
          profileId: 'fake',
          model: 'fake',
          usage: null,
          latencyMs: 1
        };
      },
      { manuscriptId: manuscript.id }
    );
    expect(generated.candidates[0].basisEventUid).toBe('evt_early');
    await acceptContinuation(worldId, generated.candidates[0].id);
    const change = await prisma.change.findFirstOrThrow({
      where: { worldId, author: 'continuation', status: 'pending' }
    });
    expect(change.payload).toMatchObject({ causeUids: ['evt_early'] });
    expect((await prisma.world.findUniqueOrThrow({ where: { id: worldId } })).masterVersion).toBe(
      2
    );
  });

  it('does not assert an order for overlapping year precision, and requires an explicit latest cursor', async () => {
    await seed();
    await stage(
      'event_upsert',
      'evt_late',
      event('年份不详月日', 1, 2, { fictionPrecision: 'year', effectUids: ['evt_early'] })
    );
    await mergeWorld(worldId);
    expect((await getRelationsAt(worldId, { atEventUid: 'evt_early' })).edges[0].ambiguous).toBe(
      true
    );
    const manuscript = await createManuscript(worldId, { title: '手动选择' });
    await expect(advanceCursorToLatest(worldId, manuscript.id)).rejects.toMatchObject({
      code: 'ambiguous_latest_event'
    });
    expect(
      (await runLint(worldId)).findings.some(
        (finding) => finding.status === 'open' && finding.rule === 'causal_inversion'
      )
    ).toBe(false);
  });

  it('keeps deleted anchors uncertain and never resolves a continuation cursor from an old version', async () => {
    await seed();
    const manuscript = await createManuscript(worldId, { title: '删除锚点' });
    await setCursor(worldId, manuscript.id, 'evt_late');
    await stage('event_delete', 'evt_late', {});
    await mergeWorld(worldId);
    expect((await getRelationsAt(worldId)).edges[0]).toMatchObject({
      active: null,
      ambiguous: true
    });
    await expect(buildWorldStateSummary(worldId, manuscript.id)).rejects.toMatchObject({
      code: 'event_not_found'
    });
    expect((await getManuscriptSummary(worldId, manuscript.id)).cursor).toBeNull();
    await expect(setCursor(worldId, manuscript.id, 'evt_late')).rejects.toMatchObject({
      code: 'event_not_found'
    });
    const graph = await getFocusGraph(worldId, 'relations');
    expect(graph.edges.find((edge) => edge.id === 'rel_end')).toMatchObject({
      stateAt: 'uncertain'
    });
    const historical = await graphRequest(
      new NextRequest(
        `http://localhost/api/worlds/${worldId}/graph?view=relations&version=2&asOf=evt_late`
      ),
      { params: Promise.resolve({ worldId }) }
    );
    expect(historical.status).toBe(200);
    expect((await historical.json()).version).toBe(2);
  });

  it('resolves epochs after the complete batch and ranks all allowed dates safely', async () => {
    await stage(
      'event_upsert',
      'evt_max',
      event('最大日期', 99, 999, { epochUid: 'epo_max', epochYear: 100_000, participantUids: [] })
    );
    await stage('epoch_upsert', 'epo_max', { name: '末纪', order: 10_000 });
    await stage('epoch_upsert', 'epo_first', { name: '初纪', order: 0 });
    await stage(
      'event_upsert',
      'evt_first',
      event('旧纪末', 99, 999, { epochUid: 'epo_first', epochYear: 100_000, participantUids: [] })
    );
    await stage('epoch_upsert', 'epo_second', { name: '次纪', order: 1 });
    await stage(
      'event_upsert',
      'evt_second',
      event('新纪始', 1, 1, { epochUid: 'epo_second', epochYear: -100_000, participantUids: [] })
    );
    expect(await prisma.chronicleEvent.count({ where: { worldId } })).toBe(0);
    await mergeWorld(worldId);
    expect((await listEvents(worldId)).map((row) => row.uid)).toEqual([
      'evt_first',
      'evt_second',
      'evt_max'
    ]);
    expect(
      (await prisma.chronicleEvent.findMany({ where: { worldId, version: 2 } })).every(
        (row) => row.sortOrder > 0 && row.sortOrder <= 3
      )
    ).toBe(true);
    await stage('epoch_upsert', 'epo_first', { name: '初纪移后', order: 10_000 });
    await stage('epoch_upsert', 'epo_max', { name: '末纪移前', order: 0 });
    await mergeWorld(worldId);
    expect((await listEvents(worldId)).map((row) => row.uid)).toEqual([
      'evt_max',
      'evt_second',
      'evt_first'
    ]);
    expect((await listEvents(worldId, 2)).map((row) => row.uid)).toEqual([
      'evt_first',
      'evt_second',
      'evt_max'
    ]);
  });

  it('preserves legacy stored keys and rows, and distinguishes numeric cursor protocol after append/rollback', async () => {
    // Directly seed the old storage representation in an owned synthetic initial version.
    await prisma.epoch.create({
      data: { worldId, version: 1, uid: 'epo_test', name: '旧纪', order: 0 }
    });
    await prisma.entity.createMany({
      data: ['a', 'b'].map((uid) => ({
        worldId,
        version: 1,
        uid: `ent_${uid}`,
        kind: 'character',
        name: uid
      }))
    });
    for (const [uid, month, title] of [
      ['early', 1, '旧一月'],
      ['late', 2, '旧二月']
    ] as const) {
      await prisma.chronicleEvent.create({
        data: {
          worldId,
          version: 1,
          uid: `evt_${uid}`,
          title,
          epochUid: 'epo_test',
          epochYear: 3,
          epochMonth: month,
          epochDay: 2,
          fictionPrecision: 'day',
          sortOrder: 10000312
        }
      });
    }
    await prisma.relationshipEvent.createMany({
      data: [
        {
          worldId,
          version: 1,
          uid: 'rel_begin',
          eventUid: 'evt_early',
          subjectUid: 'ent_a',
          objectUid: 'ent_b',
          relation: '协作',
          polarity: 'establish'
        },
        {
          worldId,
          version: 1,
          uid: 'rel_end',
          eventUid: 'evt_late',
          subjectUid: 'ent_a',
          objectUid: 'ent_b',
          relation: '协作',
          polarity: 'terminate'
        }
      ]
    });
    // Simulate a legacy epoch edit that left its coarse stored event keys stale.
    await prisma.epoch.updateMany({ where: { worldId, version: 1 }, data: { order: 100 } });
    const before = await prisma.chronicleEvent.findMany({
      where: { worldId, version: 1 },
      orderBy: { uid: 'asc' }
    });
    const legacy = await getRelationsAt(worldId, { version: 1, atSortOrder: 10000311 });
    expect(legacy.ordering).toBe('legacy-sortOrder');
    expect(legacy.edges).toHaveLength(0);
    expect(legacy.warning).toContain('atEvent');
    expect(
      (await getRelationsAt(worldId, { version: 1, atEventUid: 'evt_early' })).edges[0].active
    ).toBe(true);
    await prisma.relationshipEvent.create({
      data: {
        worldId,
        version: 1,
        uid: 'rel_foundation',
        eventUid: null,
        subjectUid: 'ent_a',
        objectUid: 'ent_b',
        relation: '基础',
        polarity: 'establish'
      }
    });
    expect((await getRelationsAt(worldId, { version: 1, atSortOrder: -2 })).edges).toHaveLength(0);
    expect(
      (await getRelationsAt(worldId, { version: 1, atSortOrder: -1 })).counts.foundational
    ).toBe(1);
    const { isMaster: _wasMaster, ...historicalContent } = await getVersionSnapshot(worldId, 1);
    await stage('entity_upsert', 'ent_a', { kind: 'character', name: '甲更新' });
    await mergeWorld(worldId);
    expect((await getVersionSnapshot(worldId, 2)).chronologyFormat).toBe('date-rank-v1');
    await expect(
      getRelationsAt(worldId, { version: 2, atSortOrder: 10000312 })
    ).rejects.toMatchObject({ code: 'legacy_time_cursor' });
    const rejectedCursor = await relationsRequest(
      new NextRequest(`http://localhost/api/worlds/${worldId}/relations?version=2&at=10000312`),
      { params: Promise.resolve({ worldId }) }
    );
    expect(rejectedCursor.status).toBe(409);
    expect((await rejectedCursor.json()).error.message).toContain('atEvent');
    await rollbackToVersion(worldId, 1);
    expect((await getVersionSnapshot(worldId, 3)).chronologyFormat).toBe('date-rank-v1');
    expect(
      await prisma.chronicleEvent.findMany({
        where: { worldId, version: 1 },
        orderBy: { uid: 'asc' }
      })
    ).toEqual(before);
    const { isMaster: _isMaster, ...afterContent } = await getVersionSnapshot(worldId, 1);
    expect(afterContent).toEqual(historicalContent);
    expect(
      (await getRelationsAt(worldId, { version: 3, atEventUid: 'evt_early' })).edges.find(
        (edge) => edge.relation === '协作'
      )?.active
    ).toBe(true);
    await expect(
      getRelationsAt(worldId, { version: 9000, atEventUid: 'evt_early' })
    ).rejects.toMatchObject({ code: 'version_not_found' });
  });
});
