import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { chat } from '@/lib/llm/client';
import {
  compileRunSummary,
  executeCompileRun,
  recoverStaleCompileRun
} from '@/lib/worldbuilding/compile-run';

type Params = { params: Promise<{ worldId: string; runId: string }> };

/** Read durable compiler progress without exposing chunk source text. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { worldId, runId } = await params;
    const run = await recoverStaleCompileRun(worldId, runId);
    if (run.status === 'queued') void executeCompileRun(run.id, chat);
    return NextResponse.json({ run: compileRunSummary(run) });
  } catch (error) {
    return errorResponse(error);
  }
}
