import { NextResponse, type NextRequest } from 'next/server';
import { getFocusGraph, getWorldGraph } from '@/lib/graph/world-graph';
import { errorResponse } from '@/lib/api';

type Params = { params: Promise<{ worldId: string }> };

/** World graph: entity nodes + relation edges + 5-signal related edges + communities. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const url = new URL(request.url);
    const view = url.searchParams.get('view');
    const asOf = url.searchParams.get('asOf');
    if (view === 'relations' || view === 'events') {
      return NextResponse.json(await getFocusGraph(worldId, view, { asOf }));
    }
    return NextResponse.json(await getWorldGraph(worldId));
  } catch (error) {
    return errorResponse(error);
  }
}
