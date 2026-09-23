import { NextResponse, type NextRequest } from 'next/server';
import { updateChapter } from '@/lib/worldbuilding/manuscript';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { z } from 'zod';

type Params = { params: Promise<{ worldId: string; manuscriptId: string; chapterId: string }> };

const patchSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.string().min(1).max(20_000).optional()
});

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { worldId, manuscriptId, chapterId } = await params;
    const body = patchSchema.parse(await readJsonBody(request, MAX_JSON_REQUEST_BYTES));
    return NextResponse.json({
      chapter: await updateChapter(worldId, manuscriptId, chapterId, body)
    });
  } catch (error) {
    return errorResponse(error);
  }
}
