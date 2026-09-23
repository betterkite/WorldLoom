import { NextResponse, type NextRequest } from 'next/server';
import { generateContinuations, listContinuations } from '@/lib/worldbuilding/continuation';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { chat } from '@/lib/llm/client';
import { z } from 'zod';

type Params = { params: Promise<{ worldId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const statusParam = new URL(request.url).searchParams.get('status');
    const status =
      statusParam === 'accepted' || statusParam === 'dismissed' || statusParam === 'pending'
        ? statusParam
        : null;
    return NextResponse.json({ continuations: await listContinuations(worldId, status) });
  } catch (error) {
    return errorResponse(error);
  }
}

const generateSchema = z.object({
  manuscriptId: z.string().optional(),
  instruction: z.string().max(2000).optional()
});

/** 推演：世界状态摘要 → 候选后续（草稿态，≤5 条）。 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const body = generateSchema.parse(
      await readJsonBody(request, MAX_JSON_REQUEST_BYTES, { allowEmpty: true })
    );
    return NextResponse.json(await generateContinuations(worldId, chat, body), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
