import { NextResponse, type NextRequest } from 'next/server';
import { mergeWorld } from '@/lib/governance/merge';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { z } from 'zod';

type Params = { params: Promise<{ worldId: string }> };

const mergeSchema = z.object({ summary: z.string().max(500).optional() });

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const body = await readJsonBody(request, MAX_JSON_REQUEST_BYTES, { allowEmpty: true });
    const { summary } = mergeSchema.parse(body ?? {});
    return NextResponse.json(await mergeWorld(worldId, { summary }));
  } catch (error) {
    return errorResponse(error);
  }
}
