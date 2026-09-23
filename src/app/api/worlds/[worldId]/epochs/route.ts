import { NextResponse, type NextRequest } from 'next/server';
import { listEpochs } from '@/lib/worldbuilding/content';
import { submitChange } from '@/lib/governance/changes';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';

type Params = { params: Promise<{ worldId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const version = new URL(request.url).searchParams.get('version');
    return NextResponse.json({ epochs: await listEpochs(worldId, version) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const body = (await readJsonBody(request, MAX_JSON_REQUEST_BYTES)) as Record<string, unknown>;
    const result = await submitChange(worldId, {
      kind: body.kind ?? 'epoch_upsert',
      targetUid: body.targetUid,
      payload: body.payload ?? body,
      author: body.author
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
