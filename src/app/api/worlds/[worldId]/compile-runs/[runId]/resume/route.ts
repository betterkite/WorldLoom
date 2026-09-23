import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import {
  compileRunSummary,
  executeCompileRun,
  resumeCompileRun
} from '@/lib/worldbuilding/compile-run';

type Params = { params: Promise<{ worldId: string; runId: string }> };

/** Resume a failed/cancelled run from its first incomplete chunk. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { worldId, runId } = await params;
    const run = await resumeCompileRun(worldId, runId);
    void executeCompileRun(run.id);
    return NextResponse.json({ run: compileRunSummary(run) }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
