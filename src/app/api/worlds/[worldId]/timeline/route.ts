import { NextResponse, type NextRequest } from 'next/server';
import { getTimeline } from '@/lib/worldbuilding/timeline';
import { errorResponse } from '@/lib/api';

type Params = { params: Promise<{ worldId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const url = new URL(request.url);
    const result = await getTimeline(worldId, {
      version: url.searchParams.get('version'),
      participantUid: url.searchParams.get('participant')
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
