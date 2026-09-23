import { NextResponse, type NextRequest } from 'next/server';
import { askWorld } from '@/lib/assistant/ask';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { z } from 'zod';

type Params = { params: Promise<{ worldId: string }> };

const askSchema = z.object({
  question: z.string().min(1).max(1000),
  topK: z.number().int().min(1).max(20).optional(),
  sediment: z.boolean().optional()
});

/** Creation assistant: evidence-constrained answer with [n] citations. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const body = askSchema.parse(await readJsonBody(request, MAX_JSON_REQUEST_BYTES));
    return NextResponse.json(await askWorld(worldId, body));
  } catch (error) {
    return errorResponse(error);
  }
}
