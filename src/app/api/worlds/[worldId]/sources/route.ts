import { NextResponse, type NextRequest } from 'next/server';
import { createSource, fetchUrlAsText, listSources } from '@/lib/intake/sources';
import { extractDocumentText } from '@/lib/intake/extract';
import { errorResponse, readJsonBody } from '@/lib/api';
import {
  MAX_SOURCE_BINARY_BYTES,
  MAX_SOURCE_REQUEST_BYTES,
  formatBytes
} from '@/lib/intake/limits';
import { z } from 'zod';

const base64Schema = z
  .string()
  .max(22_000_000)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'base64 格式无效');

type Params = { params: Promise<{ worldId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    return NextResponse.json({ sources: await listSources(worldId) });
  } catch (error) {
    return errorResponse(error);
  }
}

const sourceSchema = z.object({
  filename: z.string().max(200).optional(),
  url: z.string().url().max(2000).optional(),
  dataBase64: base64Schema.optional(),
  mediaType: z.string().max(100).optional(),
  content: z.string().min(1).max(2_000_000).optional(),
  author: z.string().max(80).optional(),
  force: z.boolean().optional()
});

/** Phase 1 intake: store + SHA256 dedupe. Compilation arrives in Phase 2. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const body = sourceSchema.parse(await readJsonBody(request, MAX_SOURCE_REQUEST_BYTES));
    if (body.url) {
      const fetched = await fetchUrlAsText(body.url);
      const result = await createSource(worldId, {
        filename: body.filename ?? fetched.title ?? 'webpage.md',
        content: fetched.content,
        mediaType: 'text/markdown',
        author: body.author,
        force: body.force
      });
      return NextResponse.json(
        { ...result, sourceUrl: body.url },
        { status: result.skipped ? 200 : 201 }
      );
    }
    if (body.dataBase64) {
      const buffer = Buffer.from(body.dataBase64, 'base64');
      if (buffer.length === 0) {
        return NextResponse.json(
          { error: { code: 'invalid_source', message: 'dataBase64 解码为空' } },
          { status: 400 }
        );
      }
      if (buffer.length > MAX_SOURCE_BINARY_BYTES) {
        return NextResponse.json(
          {
            error: {
              code: 'payload_too_large',
              message: `文件超过 ${formatBytes(MAX_SOURCE_BINARY_BYTES)} 限制`
            }
          },
          { status: 413 }
        );
      }
      const filename = body.filename ?? 'document.pdf';
      const text = await extractDocumentText(buffer, filename, body.mediaType);
      const result = await createSource(worldId, {
        filename,
        content: text,
        mediaType: 'text/markdown',
        author: body.author,
        force: body.force
      });
      return NextResponse.json(
        { ...result, extractedChars: text.length },
        { status: result.skipped ? 200 : 201 }
      );
    }
    if (!body.content) {
      return NextResponse.json(
        { error: { code: 'invalid_source', message: 'content 或 url 至少提供一个' } },
        { status: 400 }
      );
    }
    const result = await createSource(worldId, { ...body, content: body.content });
    return NextResponse.json(result, { status: result.skipped ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
