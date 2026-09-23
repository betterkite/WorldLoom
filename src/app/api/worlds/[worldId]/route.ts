import { NextResponse, type NextRequest } from 'next/server';
import { deleteWorld, getWorld, updateWorld } from '@/lib/worldbuilding/worlds';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';

type Params = { params: Promise<{ worldId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    return NextResponse.json({ world: await getWorld(worldId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const body = await readJsonBody(request, MAX_JSON_REQUEST_BYTES);
    return NextResponse.json({
      world: await updateWorld(worldId, body as Parameters<typeof updateWorld>[1])
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    return NextResponse.json(await deleteWorld(worldId));
  } catch (error) {
    return errorResponse(error);
  }
}
