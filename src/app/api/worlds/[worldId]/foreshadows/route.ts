import { NextResponse, type NextRequest } from 'next/server';
import { createForeshadow, listForeshadows } from '@/lib/worldbuilding/foreshadow';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { z } from 'zod';

type Params = { params: Promise<{ worldId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const status = new URL(request.url).searchParams.get('status');
    return NextResponse.json({ foreshadows: await listForeshadows(worldId, status) });
  } catch (error) {
    return errorResponse(error);
  }
}

const schema = z.object({
  title: z.string().min(1).max(120),
  detail: z.string().max(2000).optional(),
  plantedEventUid: z.string().nullable().optional()
});

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    return NextResponse.json(
      {
        foreshadow: await createForeshadow(
          worldId,
          z.parse(schema, await readJsonBody(request, MAX_JSON_REQUEST_BYTES))
        )
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
