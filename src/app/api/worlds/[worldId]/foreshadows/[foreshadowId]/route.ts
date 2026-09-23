import { NextResponse, type NextRequest } from 'next/server';
import { deleteForeshadow, resolveForeshadow } from '@/lib/worldbuilding/foreshadow';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { z } from 'zod';

type Params = { params: Promise<{ worldId: string; foreshadowId: string }> };

const patchSchema = z.object({
  status: z.enum(['open', 'resolved']).optional(),
  resolvedEventUid: z.string().nullable().optional(),
  detail: z.string().max(2000).optional()
});

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { worldId, foreshadowId } = await params;
    return NextResponse.json({
      foreshadow: await resolveForeshadow(
        worldId,
        foreshadowId,
        z.parse(patchSchema, await readJsonBody(request, MAX_JSON_REQUEST_BYTES))
      )
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { worldId, foreshadowId } = await params;
    return NextResponse.json(await deleteForeshadow(worldId, foreshadowId));
  } catch (error) {
    return errorResponse(error);
  }
}
