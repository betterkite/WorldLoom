import { NextResponse, type NextRequest } from 'next/server';
import { createManuscript } from '@/lib/worldbuilding/manuscript';
import { errorResponse, readTextBody } from '@/lib/api';
import { MAX_MANUSCRIPT_REQUEST_BYTES } from '@/lib/intake/limits';
import { buildImportChapters } from '@/lib/chapter-split';

type Params = { params: Promise<{ worldId: string }> };

/** Plain-text import shares the browser's lossless chapter contract. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const title =
      decodeURIComponent(request.headers.get('x-manuscript-title') ?? '') || '未命名作品';
    const text = await readTextBody(request, MAX_MANUSCRIPT_REQUEST_BYTES);
    if (!text.trim()) {
      return NextResponse.json(
        { error: { code: 'empty_source', message: '文件内容为空' } },
        { status: 400 }
      );
    }

    const chapters = buildImportChapters(text);

    const manuscript = await createManuscript(worldId, { title, chapters });
    return NextResponse.json({ manuscript, chaptersCreated: chapters.length }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
