import { NextResponse, type NextRequest } from 'next/server';
import { getRelationsAt } from '@/lib/worldbuilding/relations';
import { errorResponse } from '@/lib/api';

type Params = { params: Promise<{ worldId: string }> };

/**
 * Relationship graph folded "as of" a moment:
 *   ?atEvent=<eventUid>  → state as of that chronicle event
 *   ?at=<sortOrder>      → state at a sort position
 *   (neither)            → current master state
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const url = new URL(request.url);
    const atSortOrder = url.searchParams.get('at');
    const result = await getRelationsAt(worldId, {
      atEventUid: url.searchParams.get('atEvent'),
      atSortOrder: atSortOrder !== null ? Number(atSortOrder) : null,
      version: url.searchParams.get('version')
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
