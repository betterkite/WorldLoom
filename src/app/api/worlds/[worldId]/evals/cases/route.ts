import { NextResponse, type NextRequest } from 'next/server';
import { createEvalCase, listEvalCases } from '@/lib/evals/run';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { z } from 'zod';

type Params = { params: Promise<{ worldId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    return NextResponse.json({ cases: await listEvalCases(worldId) });
  } catch (error) {
    return errorResponse(error);
  }
}

const caseSchema = z.union([
  z.object({
    kind: z.literal('answer'),
    query: z.string().min(1).max(500),
    rubric: z.string().max(2000).optional(),
    note: z.string().max(500).optional()
  }),
  z.object({
    kind: z.literal('retrieval').optional(),
    query: z.string().min(1).max(500),
    expectedUid: z.string().min(1),
    note: z.string().max(500).optional()
  })
]);

/** 新增评测用例：kind=answer（LLM 答案质量）或缺省 retrieval（检索命中率）。 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const input = caseSchema.parse(await readJsonBody(request, MAX_JSON_REQUEST_BYTES));
    return NextResponse.json(
      {
        case: await createEvalCase(worldId, {
          kind: input.kind ?? 'retrieval',
          query: input.query,
          expectedUid: 'expectedUid' in input ? input.expectedUid : undefined,
          rubric: 'rubric' in input ? input.rubric : undefined,
          note: input.note
        })
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
