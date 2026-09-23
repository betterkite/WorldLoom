import { NextResponse, type NextRequest } from 'next/server';
import { rollbackToVersion } from '@/lib/governance/versions';
import { errorResponse } from '@/lib/api';

type Params = { params: Promise<{ worldId: string; version: string }> };

/** Rollback: copy an older immutable version forward as the new master. */
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const { worldId, version } = await params;
    const parsed = Number(version);
    if (!Number.isInteger(parsed)) {
      return NextResponse.json(
        { error: { code: 'invalid_version', message: 'version must be an integer' } },
        { status: 400 }
      );
    }
    return NextResponse.json(await rollbackToVersion(worldId, parsed));
  } catch (error) {
    return errorResponse(error);
  }
}
