import { NextResponse, type NextRequest } from 'next/server';
import { deletePendingChange, updatePendingChange } from '@/lib/governance/changes';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';

type Params = { params: Promise<{ worldId: string; changeId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { worldId, changeId } = await params;
    return NextResponse.json({
      change: await updatePendingChange(
        worldId,
        changeId,
        await readJsonBody(request, MAX_JSON_REQUEST_BYTES)
      )
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { worldId, changeId } = await params;
    return NextResponse.json(await deletePendingChange(worldId, changeId));
  } catch (error) {
    return errorResponse(error);
  }
}
