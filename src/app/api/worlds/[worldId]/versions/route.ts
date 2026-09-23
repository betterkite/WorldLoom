import { NextResponse, type NextRequest } from 'next/server';
import { listVersions } from '@/lib/governance/versions';
import { errorResponse } from '@/lib/api';

type Params = { params: Promise<{ worldId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    return NextResponse.json(await listVersions(worldId));
  } catch (error) {
    return errorResponse(error);
  }
}
