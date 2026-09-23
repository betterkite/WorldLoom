import { NextResponse, type NextRequest } from 'next/server';
import { listQaRecords } from '@/lib/assistant/ask';
import { errorResponse } from '@/lib/api';

type Params = { params: Promise<{ worldId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 50);
    return NextResponse.json({ records: await listQaRecords(worldId, limit) });
  } catch (error) {
    return errorResponse(error);
  }
}
