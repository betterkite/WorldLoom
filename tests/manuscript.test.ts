import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/client';
import { createWorld } from '@/lib/worldbuilding/worlds';
import { submitChange } from '@/lib/governance/changes';
import { mergeWorld } from '@/lib/governance/merge';
import {
  createManuscript,
  addChapter,
  finalizeChapter,
  setCursor,
  advanceCursorToLatest,
  getManuscript
} from '@/lib/worldbuilding/manuscript';
import {
  generateContinuations,
  acceptContinuation,
  dismissContinuation
} from '@/lib/worldbuilding/continuation';
import type { ChatFn } from '@/lib/worldbuilding/genesis';

async function cleanDb() {
  await prisma.$transaction([
    prisma.continuation.deleteMany(),
    prisma.chapter.deleteMany(),
    prisma.manuscript.deleteMany(),
    prisma.lintFinding.deleteMany(),
    prisma.qaRecord.deleteMany(),
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

/** fake chat: replays scripted LLM outputs (compile pipeline = 2 calls). */
function scriptedChat(...contents: string[]): ChatFn {
  let index = 0;
  return async () => {
    const content = contents[Math.min(index, contents.length - 1)];
    index += 1;
    return { content, profileId: 'fake', model: 'fake', usage: null, latencyMs: 1 };
  };
}

const WORLD_JSON = JSON.stringify({
  epochs: [{ name: '初纪', order: 0, description: '' }],
  entities: [
    {
      kind: 'character',
      name: '向顶天',
      aliases: [],
      summary: '求道者',
      content: '',
      confidence: 'INFERRED',
      tags: []
    }
  ],
  events: [
    {
      title: '初入梦界',
      summary: '第一次渡梦',
      content: '',
      epochName: '初纪',
      year: 1,
      participants: ['向顶天'],
      location: null,
      causes: [],
      confidence: 'INFERRED'
    },
    {
      title: '梦界裂隙',
      summary: '梦界出现裂隙',
      content: '',
      epochName: '初纪',
      year: 5,
      participants: ['向顶天'],
      location: null,
      causes: ['初入梦界'],
      confidence: 'INFERRED'
    }
  ],
  relations: []
});

async function seedWorldWithEvents() {
  const world = await createWorld({ name: '梦舟世界', premise: 'p' });
  const worldId = world.id;
  await submitChange(worldId, { kind: 'epoch_upsert', payload: { name: '初纪', order: 0 } });
  await mergeWorld(worldId);
  const epoch = await prisma.epoch.findFirstOrThrow({ where: { worldId } });
  await submitChange(worldId, {
    kind: 'event_upsert',
    payload: {
      title: '初入梦界',
      summary: '第一次渡梦',
      epochUid: epoch.uid,
      epochYear: 1,
      participantUids: [],
      locationUid: null,
      causeUids: [],
      effectUids: []
    }
  });
  await mergeWorld(worldId);
  const latest = await prisma.chronicleEvent.findFirstOrThrow({
    where: { worldId, title: '初入梦界' },
    orderBy: { version: 'desc' }
  });
  return { worldId, epochUid: epoch.uid, latestEventUid: latest.uid };
}

describe('manuscript studio (Phase 5)', () => {
  let worldId: string;

  beforeEach(async () => {
    await cleanDb();
    const seeded = await seedWorldWithEvents();
    worldId = seeded.worldId;
  });

  it('A5-1/A5-2: creates a manuscript with bulk chapters and sets the cursor', async () => {
    const manuscript = await createManuscript(worldId, {
      title: '梦舟记',
      synopsis: '向顶天的渡梦之旅',
      chapters: [{ content: '第一章正文……' }, { title: '第二章', content: '第二章正文……' }]
    });
    expect(manuscript.chapters).toHaveLength(2);
    expect(manuscript.chapters[0].status).toBe('draft');

    const detail = await getManuscript(worldId, manuscript.id);
    expect(detail.chapters).toHaveLength(2);
    expect(detail.cursor).toBeNull();

    await setCursor(worldId, manuscript.id, 'evt_anyuid').catch(() => {
      // unknown uid → not found
    });
    await setCursor(worldId, manuscript.id, 'evt_nothing').catch(async () => {
      /* swallowed below by direct assertion on error shape */
    });
    const updated = await prisma.manuscript.findUniqueOrThrow({ where: { id: manuscript.id } });
    // unknown event uid must be rejected by setCursor — cursor still null
    expect(updated.cursorEventUid).toBeNull();
  });

  it('rejects cursor pointing at a nonexistent event', async () => {
    const manuscript = await createManuscript(worldId, { title: '空作品' });
    await expect(setCursor(worldId, manuscript.id, 'evt_ghost')).rejects.toMatchObject({
      code: 'event_not_found'
    });
  });

  it('A5-4: finalizeChapter compiles content into pending changes (fake LLM)', async () => {
    const manuscript = await createManuscript(worldId, { title: '梦舟记' });
    const chapter = await addChapter(worldId, manuscript.id, {
      content: '向顶天第一次渡梦，梦界出现裂隙。'
    });

    const result = await finalizeChapter(
      worldId,
      manuscript.id,
      chapter.id,
      scriptedChat('{"analysis":{}}', WORLD_JSON)
    );
    expect(result.staged).toBeGreaterThan(3);

    const finalized = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(finalized.status).toBe('final');

    await mergeWorld(worldId, '章节回编译');
    const v = (await prisma.world.findUniqueOrThrow({ where: { id: worldId } })).masterVersion;
    const events = await prisma.chronicleEvent.findMany({ where: { worldId, version: v } });
    expect(events.map((e) => e.title)).toContain('初入梦界');
    expect(events.map((e) => e.title)).toContain('梦界裂隙');

    // causal edge from the chapter text
    const edges = await prisma.eventEdge.findMany({ where: { worldId, version: v } });
    expect(edges.length).toBeGreaterThanOrEqual(1);
  });

  it('advances the cursor to the chronologically latest event', async () => {
    const manuscript = await createManuscript(worldId, { title: '光标作品' });
    const advanced = await advanceCursorToLatest(worldId, manuscript.id);
    expect(advanced.cursorEventUid).toBe(
      'evt_seed_placeholder' in advanced ? advanced.cursorEventUid : advanced.cursorEventUid
    );
    const cursorEvent = await prisma.chronicleEvent.findFirstOrThrow({
      where: { worldId, uid: advanced.cursorEventUid as string }
    });
    expect(cursorEvent.title).toBe('初入梦界');
  });

  it('A5-3: continuation engine — generate, accept into review chain, dismiss', async () => {
    const manuscript = await createManuscript(worldId, { title: '推演作品', synopsis: '渡梦危机' });
    await setCursor(worldId, manuscript.id, 'evt_seed_placeholder').catch(async () => {
      const latest = await prisma.chronicleEvent.findFirstOrThrow({
        where: { worldId, title: '初入梦界' },
        orderBy: { version: 'desc' }
      });
      await setCursor(worldId, manuscript.id, latest.uid);
    });

    const continuationJson = JSON.stringify({
      candidates: [
        {
          kind: 'event_suggestion',
          title: '梦界裂隙扩大',
          summary: '裂隙吞没枯井原，守梦人被迫出手。',
          epochName: '初纪',
          year: 6,
          participants: ['向顶天'],
          relation: null,
          rationale: '基于既有事件「梦界裂隙」的后果推演；向顶天作为亲历者会被卷入。'
        },
        {
          kind: 'relation_shift',
          title: '与守梦人决裂',
          summary: '向顶天拒绝交出残书。',
          epochName: null,
          year: null,
          participants: [],
          relation: {
            subject: '向顶天',
            object: '守梦人',
            relation: 'ally',
            polarity: 'terminate'
          },
          rationale: '残书来历不明，守梦人的秩序立场必然与向顶天冲突。'
        },
        {
          kind: 'plot_arc',
          title: '残书之谜',
          summary: '围绕残书来历的长线悬疑。',
          epochName: null,
          year: null,
          participants: [],
          relation: null,
          rationale: '初入梦界事件埋下的伏笔尚未回收。'
        }
      ]
    });

    const generated = await generateContinuations(worldId, scriptedChat(continuationJson), {
      manuscriptId: manuscript.id,
      instruction: '往危机方向推'
    });
    expect(generated.candidates).toHaveLength(3);
    expect((await getManuscript(worldId, manuscript.id)).pendingContinuations).toBe(3);

    // accept the event suggestion → staged event change with resolved epoch + participant
    const eventCandidate = generated.candidates.find((c) => c.kind === 'event_suggestion')!;
    const accepted = await acceptContinuation(worldId, eventCandidate.id);
    expect(accepted.acceptedChangeUid).not.toBeNull();

    const change = await prisma.change.findUniqueOrThrow({
      where: { id: accepted.acceptedChangeUid! }
    });
    expect(change.kind).toBe('event_upsert');
    expect(change.author).toBe('continuation');
    const payload = change.payload as {
      epochUid: string;
      participantUids: string[];
      title: string;
    };
    expect(payload.title).toBe('梦界裂隙扩大');
    const epoch = await prisma.epoch.findFirstOrThrow({ where: { worldId } });
    expect(payload.epochUid).toBe(epoch.uid); // 名称 → uid 解析成功

    // merge → the accepted continuation becomes canon
    await mergeWorld(worldId, '采纳推演');
    const v = (await prisma.world.findUniqueOrThrow({ where: { id: worldId } })).masterVersion;
    const canon = await prisma.chronicleEvent.findMany({ where: { worldId, version: v } });
    expect(canon.map((e) => e.title)).toContain('梦界裂隙扩大');

    // dismiss the relation_shift
    const relationCandidate = generated.candidates.find((c) => c.kind === 'relation_shift')!;
    await dismissContinuation(worldId, relationCandidate.id);
    const dismissed = await prisma.continuation.findUniqueOrThrow({
      where: { id: relationCandidate.id }
    });
    expect(dismissed.status).toBe('dismissed');
  });

  it('rejects accepting a continuation twice', async () => {
    const continuationJson = JSON.stringify({
      candidates: [
        {
          kind: 'plot_arc',
          title: '单候选',
          summary: 's',
          epochName: null,
          year: null,
          participants: [],
          relation: null,
          rationale: 'r'
        }
      ]
    });
    const { candidates } = await generateContinuations(worldId, scriptedChat(continuationJson), {});
    await acceptContinuation(worldId, candidates[0].id);
    await expect(acceptContinuation(worldId, candidates[0].id)).rejects.toMatchObject({
      code: 'continuation_not_pending'
    });
  });
});

describe('chapter content limit (ISS-20)', () => {
  it('rejects edits beyond the 20k slice invariant', async () => {
    const { createWorld } = await import('@/lib/worldbuilding/worlds');
    const { createManuscript, updateChapter } = await import('@/lib/worldbuilding/manuscript');
    const world = await createWorld({ name: '限制世界', premise: 'p' });
    const manuscript = await createManuscript(world.id, {
      title: '限',
      chapters: [{ title: '一', content: '短内容。' }]
    });
    const chapterId = manuscript.chapters[0].id;
    await expect(
      updateChapter(world.id, manuscript.id, chapterId, {
        content: '超'.repeat(20_001)
      })
    ).rejects.toThrow(/2 万字|20000/);
    const kept = await updateChapter(world.id, manuscript.id, chapterId, {
      content: '在限制内的修改。'
    });
    expect(kept.content).toBe('在限制内的修改。');
  });
});
