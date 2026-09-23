import { NextResponse, type NextRequest } from 'next/server';
import { listChanges, listChangesDetailed, submitChange } from '@/lib/governance/changes';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';

type Params = { params: Promise<{ worldId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const statusParam = new URL(request.url).searchParams.get('status');
    const status = statusParam === 'pending' || statusParam === 'merged' ? statusParam : null;
    const detailed = new URL(request.url).searchParams.get('detailed') === '1';
    return NextResponse.json({
      changes: detailed
        ? await listChangesDetailed(worldId, status)
        : await listChanges(worldId, status)
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Generic change submission (any ChangeKind) — used by review UI and tooling. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const result = await submitChange(worldId, await readJsonBody(request, MAX_JSON_REQUEST_BYTES));
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
