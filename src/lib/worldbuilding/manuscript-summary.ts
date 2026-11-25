import { prisma } from '@/lib/db/client';
import { GovernanceError } from '@/lib/governance/changes';

export type ChapterSummary = {
  id: string;
  order: number;
  title: string;
  status: string;
  contentLength: number;
};

/** Browsing a book loads its directory, not every chapter's full text. */
export async function getManuscriptSummary(worldId: string, manuscriptId: string) {
  const manuscript = await prisma.manuscript.findFirst({
    where: { id: manuscriptId, worldId },
    select: {
      id: true,
      title: true,
      synopsis: true,
      cursorEventUid: true,
      world: { select: { masterVersion: true } },
      _count: { select: { continuations: { where: { status: 'pending' } } } }
    }
  });
  if (!manuscript) throw new GovernanceError('manuscript_not_found', 'Manuscript not found');
  // PostgreSQL computes the count. Chapter bodies never cross the DB boundary
  // merely to show the directory. Counts are Unicode characters, not bytes.
  const chapters = await prisma.$queryRaw<ChapterSummary[]>`
    SELECT c.id, c."order", c.title, c.status, length(c.content) AS "contentLength"
    FROM chapters c JOIN manuscripts m ON m.id = c."manuscriptId"
    WHERE c."manuscriptId" = ${manuscriptId} AND m."worldId" = ${worldId}
    ORDER BY c."order" ASC
  `;
  const cursor = manuscript.cursorEventUid
    ? await prisma.chronicleEvent.findFirst({
        where: { worldId, version: manuscript.world.masterVersion, uid: manuscript.cursorEventUid },
        select: { uid: true, title: true, epochYear: true }
      })
    : null;
  const { _count, world: _world, ...metadata } = manuscript;
  return { ...metadata, chapters, cursor, pendingContinuations: _count.continuations };
}

export async function getManuscriptChapter(
  worldId: string,
  manuscriptId: string,
  chapterId: string
) {
  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, manuscriptId, manuscript: { worldId } }
  });
  if (!chapter) throw new GovernanceError('chapter_not_found', 'Chapter not found');
  return chapter;
}
