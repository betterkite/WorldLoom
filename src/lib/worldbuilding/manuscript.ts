import { prisma } from '@/lib/db/client';
import { GovernanceError, requireWorld } from '@/lib/governance/changes';
import { createCompileRun, executeCompileRun } from './compile-run';
import type { ChatFn } from './genesis';
import { createChronology } from './chronology';
import { IMPORT_CHAPTER_CONTENT_LIMIT, splitChapterContent } from '@/lib/chapter-split';

/**
 * Manuscript studio (Phase 5 core loop):
 *   半成品接入 → 光标定位 → 推演候选（草稿）→ 采纳/续写 → 定稿回编译 → 光标前移
 */

export const CHAPTER_CONTENT_LIMIT = IMPORT_CHAPTER_CONTENT_LIMIT;

export async function createManuscript(
  worldId: string,
  input: {
    title: string;
    synopsis?: string;
    chapters?: { title?: string | null; content: string }[];
  }
) {
  await requireWorld(worldId);
  const title = String(input.title ?? '').trim();
  if (!title) throw new GovernanceError('invalid_manuscript', 'Manuscript title is required');
  const allPieces: { title: string; content: string }[] = [];
  for (const chapter of input.chapters ?? []) {
    for (const piece of splitChapterContent(chapter.content)) {
      allPieces.push({ title: chapter.title || '', content: piece });
    }
  }

  return prisma.manuscript.create({
    data: {
      worldId,
      title,
      synopsis: input.synopsis ?? '',
      chapters: {
        create: allPieces.map((piece, index) => ({
          order: index + 1,
          title: piece.title || `第 ${index + 1} 章`,
          content: piece.content,
          status: 'draft' as const
        }))
      }
    },
    include: { chapters: { orderBy: { order: 'asc' } } }
  });
}

export async function listManuscripts(worldId: string) {
  await requireWorld(worldId);
  return prisma.manuscript.findMany({
    where: { worldId },
    orderBy: { updatedAt: 'desc' },
    include: {
      chapters: { orderBy: { order: 'asc' }, select: { id: true, status: true, title: true } }
    }
  });
}

export async function getManuscript(worldId: string, manuscriptId: string) {
  const world = await requireWorld(worldId);
  const manuscript = await prisma.manuscript.findUnique({
    where: { id: manuscriptId },
    include: {
      chapters: { orderBy: { order: 'asc' } },
      continuations: { orderBy: { createdAt: 'desc' } }
    }
  });
  if (!manuscript || manuscript.worldId !== worldId) {
    throw new GovernanceError('manuscript_not_found', 'Manuscript not found');
  }
  const cursor = manuscript.cursorEventUid
    ? await prisma.chronicleEvent.findFirst({
        where: { worldId, version: world.masterVersion, uid: manuscript.cursorEventUid },
        select: { uid: true, title: true, sortOrder: true, epochYear: true }
      })
    : null;
  const pendingContinuations = manuscript.continuations.filter(
    (c) => c.status === 'pending'
  ).length;
  return { ...manuscript, cursor, pendingContinuations };
}

export async function addChapter(
  worldId: string,
  manuscriptId: string,
  input: { title?: string; content: string }
) {
  const manuscript = await prisma.manuscript.findUnique({ where: { id: manuscriptId } });
  if (!manuscript || manuscript.worldId !== worldId) {
    throw new GovernanceError('manuscript_not_found', 'Manuscript not found');
  }
  if (!input.content?.length) {
    throw new GovernanceError('invalid_chapter', 'Chapter content is required');
  }
  if (input.content.length > CHAPTER_CONTENT_LIMIT) {
    throw new GovernanceError('invalid_chapter', `Chapter exceeds ${CHAPTER_CONTENT_LIMIT} units`);
  }
  const last = await prisma.chapter.findFirst({
    where: { manuscriptId },
    orderBy: { order: 'desc' },
    select: { order: true }
  });
  return prisma.chapter.create({
    data: {
      manuscriptId,
      order: (last?.order ?? 0) + 1,
      title: input.title?.trim() || `第 ${(last?.order ?? 0) + 1} 章`,
      content: input.content,
      status: 'draft'
    }
  });
}

export async function updateChapter(
  worldId: string,
  manuscriptId: string,
  chapterId: string,
  input: { title?: string; content?: string }
) {
  await requireManuscriptChapter(worldId, manuscriptId, chapterId);
  // 每片 ≤2 万字是切片不变量（导入路径强制分片，编辑路径同样必须守住）
  if (input.content !== undefined && input.content.length > CHAPTER_CONTENT_LIMIT) {
    throw new Error(`章节内容超过 ${CHAPTER_CONTENT_LIMIT} 字上限，请拆分后再保存`);
  }
  return prisma.chapter.update({
    where: { id: chapterId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.content !== undefined
        ? { content: input.content, status: 'draft', finalAt: null }
        : {})
    }
  });
}

async function requireManuscriptChapter(worldId: string, manuscriptId: string, chapterId: string) {
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter || chapter.manuscriptId !== manuscriptId) {
    throw new GovernanceError('chapter_not_found', 'Chapter not found');
  }
  const manuscript = await prisma.manuscript.findUnique({ where: { id: manuscriptId } });
  if (!manuscript || manuscript.worldId !== worldId) {
    throw new GovernanceError('manuscript_not_found', 'Manuscript not found');
  }
  return chapter;
}

/** Queue chapter finalization through the durable compiler runner (ISS-31). */
export async function createChapterCompileRun(
  worldId: string,
  manuscriptId: string,
  chapterId: string
) {
  const chapter = await requireManuscriptChapter(worldId, manuscriptId, chapterId);
  if (chapter.status === 'final') {
    throw new GovernanceError('chapter_already_final', 'Chapter is already finalized');
  }
  return createCompileRun(worldId, {
    kind: 'chapter',
    chapterId,
    sourceFilename: `章节 · ${chapter.title}`,
    sourceContent: chapter.content
  });
}

/**
 * Backward-compatible synchronous helper for callers that still need a result
 * in-process. It delegates to the same durable CompileRun used by the HTTP
 * route; there is no second compiler implementation here.
 */
export async function finalizeChapter(
  worldId: string,
  manuscriptId: string,
  chapterId: string,
  chat: ChatFn
) {
  const created = await createChapterCompileRun(worldId, manuscriptId, chapterId);
  const run = await executeCompileRun(created.run.id, chat);
  const result = (run.result ?? {}) as {
    staged?: number;
    defects?: { kind: string; name: string; reason: string }[];
    batchId?: string | null;
    chunks?: number;
    degradedSourceId?: string;
  };
  return {
    staged: result.staged ?? 0,
    defects:
      result.defects ?? (run.error ? [{ kind: 'chapter', name: '章节', reason: run.error }] : []),
    batchId: result.batchId ?? run.batchId,
    chapterId,
    failed: run.status !== 'completed',
    chunks: result.chunks ?? run.totalChunks,
    ...(result.degradedSourceId ? { degradedSourceId: result.degradedSourceId } : {})
  };
}

/** Set the narrative cursor to a chronicle event (story "now"). */
export async function setCursor(
  worldId: string,
  manuscriptId: string,
  eventUid: string | null,
  expectedVersion?: number
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${worldId}))`;
    const world = await tx.world.findUnique({ where: { id: worldId } });
    if (!world) throw new GovernanceError('world_not_found', 'World not found');
    if (expectedVersion !== undefined && world.masterVersion !== expectedVersion) {
      throw new GovernanceError(
        'revision_conflict',
        'World changed while selecting the latest event'
      );
    }
    if (eventUid) {
      const event = await tx.chronicleEvent.findFirst({
        where: { worldId, version: world.masterVersion, uid: eventUid }
      });
      if (!event)
        throw new GovernanceError(
          'event_not_found',
          'Cursor event not found in the master version'
        );
    }
    const manuscript = await tx.manuscript.findUnique({ where: { id: manuscriptId } });
    if (!manuscript || manuscript.worldId !== worldId) {
      throw new GovernanceError('manuscript_not_found', 'Manuscript not found');
    }
    return tx.manuscript.update({
      where: { id: manuscriptId },
      data: { cursorEventUid: eventUid }
    });
  });
}

/** Advance the cursor to the chronologically latest master event. */
export async function advanceCursorToLatest(worldId: string, manuscriptId: string) {
  const world = await requireWorld(worldId);
  const [events, epochs] = await Promise.all([
    prisma.chronicleEvent.findMany({ where: { worldId, version: world.masterVersion } }),
    prisma.epoch.findMany({ where: { worldId, version: world.masterVersion } })
  ]);
  const chronology = createChronology(events, epochs);
  const latest = chronology.latest();
  if (!latest.length) throw new GovernanceError('event_not_found', 'No events to advance to');
  if (latest.length > 1 && !latest.every((event) => chronology.sameInstant(event, latest[0]))) {
    throw new GovernanceError('ambiguous_latest_event', 'Choose an event or specify its date');
  }
  const manuscript = await setCursor(worldId, manuscriptId, latest[0].uid, world.masterVersion);
  return {
    ...manuscript,
    cursorWarning:
      latest.length > 1
        ? '最新日期有多个同日事件，已选择其中一个；同日事件之间尚无确定先后。'
        : null
  };
}

/** 删除作品（章节随 Prisma 级联删除；推演候选的世界归属保留）。 */
export async function deleteManuscript(worldId: string, manuscriptId: string) {
  const manuscript = await prisma.manuscript.findUnique({ where: { id: manuscriptId } });
  if (!manuscript || manuscript.worldId !== worldId) {
    throw new GovernanceError('manuscript_not_found', 'Manuscript not found');
  }
  await prisma.manuscript.delete({ where: { id: manuscriptId } });
  return { id: manuscriptId, title: manuscript.title, deleted: true };
}
