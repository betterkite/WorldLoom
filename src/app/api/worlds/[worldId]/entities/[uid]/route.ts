import { NextResponse, type NextRequest } from 'next/server';
import { getEntity } from '@/lib/worldbuilding/content';
import { errorResponse } from '@/lib/api';

type Params = { params: Promise<{ worldId: string; uid: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { worldId, uid } = await params;
    const version = new URL(request.url).searchParams.get('version');
    return NextResponse.json({ entity: await getEntity(worldId, uid, version) });
  } catch (error) {
    return errorResponse(error);
  }
}
