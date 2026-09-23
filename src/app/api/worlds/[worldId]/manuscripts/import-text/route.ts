import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createManuscript } from '@/lib/worldbuilding/manuscript';
import { errorResponse, readTextBody } from '@/lib/api';
import { MAX_MANUSCRIPT_REQUEST_BYTES } from '@/lib/intake/limits';

type Params = { params: Promise<{ worldId: string }> };

/** 纯文本长篇导入：服务端按 2 万字切片并去重（避免超长 JSON 请求体问题）。 */
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

    const LIMIT = 20_000;
    const seen = new Set<string>();
    const chapters: { title: string; content: string }[] = [];
    // 优先按章节标题切分；否则按 2 万字切片
    const byChapter = /(^|\n)\s*第[一二三四五六七八九十百千零两0-9]+\s*[章回节]/.test(text)
      ? text.split(/\n(?=\s*第[一二三四五六七八九十百千零两0-9]+\s*[章回节])/)
      : [text];
    for (const block of byChapter) {
      if (block.length <= LIMIT) {
        const hash = createHash('sha256').update(block.trim()).digest('hex');
        if (!seen.has(hash) && block.trim()) {
          seen.add(hash);
          chapters.push({
            title: block.trim().split('\n')[0].slice(0, 60) || '章节',
            content: block
          });
        }
        continue;
      }
      for (let offset = 0; offset < block.length; offset += LIMIT) {
        const piece = block.slice(offset, offset + LIMIT);
        const hash = createHash('sha256').update(piece.trim()).digest('hex');
        if (seen.has(hash)) continue;
        seen.add(hash);
        chapters.push({
          title: `${chapters.length + 1} · 第 ${Math.floor(offset / LIMIT) + 1} 部分`,
          content: piece
        });
      }
    }

    const manuscript = await createManuscript(worldId, { title, chapters });
    return NextResponse.json({ manuscript, chaptersCreated: chapters.length }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
