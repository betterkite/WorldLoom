import { NextResponse } from 'next/server';
import { createChapterCompileRun } from '@/lib/worldbuilding/manuscript';
import { executeCompileRun, compileRunSummary } from '@/lib/worldbuilding/compile-run';
import { errorResponse } from '@/lib/api';

type Params = { params: Promise<{ worldId: string; manuscriptId: string; chapterId: string }> };

/** 定稿回编译：创建持久化任务，完成后才把 chapter 标记为 final。 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { worldId, manuscriptId, chapterId } = await params;
    const created = await createChapterCompileRun(worldId, manuscriptId, chapterId);
    void executeCompileRun(created.run.id);
    return NextResponse.json(
      { runId: created.run.id, run: compileRunSummary(created.run), reused: created.reused },
      { status: 202 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
