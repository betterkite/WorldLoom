import { NextResponse, type NextRequest } from 'next/server';
import { listEntities } from '@/lib/worldbuilding/content';
import { submitChange } from '@/lib/governance/changes';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';

type Params = { params: Promise<{ worldId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind') ?? undefined;
    const version = url.searchParams.get('version');
    const entities = await listEntities(worldId, version, kind ?? undefined);
    return NextResponse.json({ entities });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Submit an entity create/update as a pending Change (audit chain). */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const body = (await readJsonBody(request, MAX_JSON_REQUEST_BYTES)) as Record<string, unknown>;
    const result = await submitChange(worldId, {
      kind: body.kind ?? 'entity_upsert',
      targetUid: body.targetUid,
      payload: body.payload ?? body,
      author: body.author,
      batchId: body.batchId
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
