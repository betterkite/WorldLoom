import { NextResponse, type NextRequest } from 'next/server';
import { deleteManuscript, getManuscript } from '@/lib/worldbuilding/manuscript';
import { errorResponse } from '@/lib/api';
import { getManuscriptSummary } from '@/lib/worldbuilding/manuscript-summary';

type Params = { params: Promise<{ worldId: string; manuscriptId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { worldId, manuscriptId } = await params;
    const summary = request.nextUrl.searchParams.get('chapters') === 'summary';
    return NextResponse.json({
      manuscript: summary
        ? await getManuscriptSummary(worldId, manuscriptId)
        : await getManuscript(worldId, manuscriptId)
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { worldId, manuscriptId } = await params;
    return NextResponse.json(await deleteManuscript(worldId, manuscriptId));
  } catch (error) {
    return errorResponse(error);
  }
}
