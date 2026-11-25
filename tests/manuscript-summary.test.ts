import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/client';
import { getManuscriptChapter, getManuscriptSummary } from '@/lib/worldbuilding/manuscript-summary';
import { GET as getDirectory } from '@/app/api/worlds/[worldId]/manuscripts/[manuscriptId]/route';
import { GET as getChapter } from '@/app/api/worlds/[worldId]/manuscripts/[manuscriptId]/chapters/[chapterId]/route';
import { NextRequest } from 'next/server';

let worldId: string;
let manuscriptId: string;
let chapterId: string;
let otherWorldId: string;
beforeEach(async () => {
  const world = await prisma.world.create({ data: { name: `Directory fixture ${randomUUID()}` } });
  const other = await prisma.world.create({ data: { name: `Scope fixture ${randomUUID()}` } });
  worldId = world.id;
  otherWorldId = other.id;
  const manuscript = await prisma.manuscript.create({
    data: {
      worldId,
      title: 'Directory fixture',
      chapters: {
        create: [
          { order: 1, title: 'Unicode', content: '甲🚀', status: 'draft' },
          { order: 2, title: 'Long', content: '合成正文'.repeat(5_000), status: 'draft' }
        ]
      },
      continuations: {
        create: [
          {
            worldId,
            kind: 'event_suggestion',
            payload: {},
            rationale: 'fixture',
            status: 'pending'
          },
          {
            worldId,
            kind: 'event_suggestion',
            payload: {},
            rationale: 'fixture',
            status: 'dismissed'
          }
        ]
      }
    },
    include: { chapters: { orderBy: { order: 'asc' } } }
  });
  manuscriptId = manuscript.id;
  chapterId = manuscript.chapters[0].id;
});
afterEach(async () => {
  // Only this test's UUID-scoped worlds; never truncate the shared database.
  await prisma.world.deleteMany({ where: { id: { in: [worldId, otherWorldId] } } });
});

describe('bounded manuscript directory and on-demand chapter reads', () => {
  it('returns metadata and Unicode counts without chapter or continuation bodies', async () => {
    const result = await getManuscriptSummary(worldId, manuscriptId);
    expect(result.pendingContinuations).toBe(1);
    expect(result.chapters.map((chapter) => chapter.contentLength)).toEqual([2, 20_000]);
    expect(result.chapters.every((chapter) => !('content' in chapter))).toBe(true);
    expect('continuations' in result).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(2_000);
    expect((await getManuscriptChapter(worldId, manuscriptId, chapterId)).content).toBe('甲🚀');
  });

  it('scopes both directory and body reads to the world and manuscript', async () => {
    await expect(getManuscriptSummary(otherWorldId, manuscriptId)).rejects.toMatchObject({
      code: 'manuscript_not_found'
    });
    await expect(getManuscriptChapter(otherWorldId, manuscriptId, chapterId)).rejects.toMatchObject(
      { code: 'chapter_not_found' }
    );
    await expect(
      getManuscriptChapter(worldId, 'unrelated-manuscript', chapterId)
    ).rejects.toMatchObject({ code: 'chapter_not_found' });
  });

  it('provides opt-in summary HTTP responses while preserving existing full-detail clients', async () => {
    const params = { params: Promise.resolve({ worldId, manuscriptId }) };
    const base = `http://localhost/api/worlds/${worldId}/manuscripts/${manuscriptId}`;
    const summary = await getDirectory(new NextRequest(`${base}?chapters=summary`), params);
    expect(summary.status).toBe(200);
    expect(
      (await summary.json()).manuscript.chapters.every(
        (chapter: unknown) => !('content' in (chapter as object))
      )
    ).toBe(true);
    const full = await getDirectory(new NextRequest(base), params);
    expect((await full.json()).manuscript.chapters[0].content).toBe('甲🚀');
  });

  it('serves just the requested chapter; wrong-world requests return 404', async () => {
    const response = await getChapter(new NextRequest('http://localhost/chapter'), {
      params: Promise.resolve({ worldId, manuscriptId, chapterId })
    });
    expect(response.status).toBe(200);
    expect((await response.json()).chapter.content).toBe('甲🚀');
    const wrong = await getChapter(new NextRequest('http://localhost/chapter'), {
      params: Promise.resolve({ worldId: otherWorldId, manuscriptId, chapterId })
    });
    expect(wrong.status).toBe(404);
  });
});
