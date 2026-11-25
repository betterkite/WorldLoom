import { NextResponse, type NextRequest } from 'next/server';
import { addChapter } from '@/lib/worldbuilding/manuscript';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { z } from 'zod';
import { IMPORT_CHAPTER_CONTENT_LIMIT } from '@/lib/chapter-split';

type Params = { params: Promise<{ worldId: string; manuscriptId: string }> };

const schema = z.object({
  chapters: z
    .array(
      z.object({
        title: z.string().max(200).optional(),
        content: z.string().min(1).max(IMPORT_CHAPTER_CONTENT_LIMIT)
      })
    )
    .min(1)
    .max(50)
});

/** 分批追加章节：浏览器端把长篇切成小批依次提交，避免单次请求体积过大。 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId, manuscriptId } = await params;
    const { chapters } = schema.parse(await readJsonBody(request, MAX_JSON_REQUEST_BYTES));
    let created = 0;
    for (const chapter of chapters) {
      await addChapter(worldId, manuscriptId, chapter);
      created += 1;
    }
    return NextResponse.json({ appended: created }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
