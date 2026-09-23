import { NextResponse, type NextRequest } from 'next/server';
import { addChapter } from '@/lib/worldbuilding/manuscript';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { z } from 'zod';

type Params = { params: Promise<{ worldId: string; manuscriptId: string }> };

const addSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.string().min(1).max(2_000_000)
});

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId, manuscriptId } = await params;
    const body = addSchema.parse(await readJsonBody(request, MAX_JSON_REQUEST_BYTES));
    return NextResponse.json(
      { chapter: await addChapter(worldId, manuscriptId, body) },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
