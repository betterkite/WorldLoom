import { NextResponse, type NextRequest } from 'next/server';
import { listEvalRuns, runEval } from '@/lib/evals/run';
import { runAnswerEval } from '@/lib/evals/answer';
import { listEvalCases } from '@/lib/evals/run';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { z } from 'zod';

type Params = { params: Promise<{ worldId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    return NextResponse.json({
      runs: await listEvalRuns(worldId),
      cases: await listEvalCases(worldId)
    });
  } catch (error) {
    return errorResponse(error);
  }
}

const runSchema = z.union([
  z.object({
    mode: z.literal('answer'),
    cases: z
      .array(
        z.object({
          query: z.string().min(1).max(1000),
          rubric: z.string().max(2000).optional()
        })
      )
      .min(1)
      .max(20)
  }),
  z.object({
    cases: z
      .array(
        z.object({
          query: z.string().min(1),
          expectedUid: z.string().min(1),
          note: z.string().optional()
        })
      )
      .min(1)
      .max(50)
  })
]);

/** 跑一轮评测：mode=answer 为 LLM 答案评测，缺省为检索命中率。 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const parsed = runSchema.parse(await readJsonBody(request, MAX_JSON_REQUEST_BYTES));
    if ('mode' in parsed) {
      return NextResponse.json(await runAnswerEval(worldId, parsed.cases), { status: 202 });
    }
    return NextResponse.json(await runEval(worldId, parsed.cases), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
