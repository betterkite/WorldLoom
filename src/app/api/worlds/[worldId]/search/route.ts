import { NextResponse, type NextRequest } from 'next/server';
import { searchWorld } from '@/lib/retrieval/search';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { z } from 'zod';

type Params = { params: Promise<{ worldId: string }> };

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  topK: z.number().int().min(1).max(20).optional()
});

/** Hybrid retrieval: lexical bigram BM25 ⊕ optional pgvector semantic (RRF). */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const { query, topK } = searchSchema.parse(await readJsonBody(request, MAX_JSON_REQUEST_BYTES));
    return NextResponse.json(await searchWorld(worldId, query, { topK }));
  } catch (error) {
    return errorResponse(error);
  }
}
