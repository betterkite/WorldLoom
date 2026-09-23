import { NextResponse } from 'next/server';
import { dismissContinuation } from '@/lib/worldbuilding/continuation';
import { errorResponse } from '@/lib/api';

type Params = { params: Promise<{ worldId: string; continuationId: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const { worldId, continuationId } = await params;
    return NextResponse.json(await dismissContinuation(worldId, continuationId));
  } catch (error) {
    return errorResponse(error);
  }
}
