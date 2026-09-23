import { NextResponse, type NextRequest } from 'next/server';
import { getVersionSnapshot } from '@/lib/governance/versions';
import { errorResponse } from '@/lib/api';

type Params = { params: Promise<{ worldId: string; version: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { worldId, version } = await params;
    const parsed = Number(version);
    if (!Number.isInteger(parsed)) {
      return NextResponse.json(
        { error: { code: 'invalid_version', message: 'version must be an integer' } },
        { status: 400 }
      );
    }
    return NextResponse.json(await getVersionSnapshot(worldId, parsed));
  } catch (error) {
    return errorResponse(error);
  }
}
