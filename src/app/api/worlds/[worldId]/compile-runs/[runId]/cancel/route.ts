import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { cancelCompileRun, compileRunSummary } from '@/lib/worldbuilding/compile-run';

type Params = { params: Promise<{ worldId: string; runId: string }> };

/** Request cancellation; an in-flight provider call finishes before the runner stops. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { worldId, runId } = await params;
    const run = await cancelCompileRun(worldId, runId);
    return NextResponse.json({ run: compileRunSummary(run) });
  } catch (error) {
    return errorResponse(error);
  }
}
