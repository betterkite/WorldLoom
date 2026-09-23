import { NextResponse, type NextRequest } from 'next/server';
import { extractDocumentText } from '@/lib/intake/extract';
import { errorResponse, readJsonBody } from '@/lib/api';
import {
  MAX_SOURCE_BINARY_BYTES,
  MAX_SOURCE_REQUEST_BYTES,
  formatBytes
} from '@/lib/intake/limits';
import { z } from 'zod';

type Params = { params: Promise<{ worldId: string }> };

const schema = z.object({
  dataBase64: z
    .string()
    .min(1)
    .max(22_000_000)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'base64 格式无效'),
  filename: z.string().min(1).max(200),
  mediaType: z.string().max(100).optional()
});

/** ISS-12：把 PDF / EPUB 文稿抽成文本，供「故事创作」导入为章节（不落库）。 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    await params;
    const body = schema.parse(await readJsonBody(request, MAX_SOURCE_REQUEST_BYTES));
    const buffer = Buffer.from(body.dataBase64, 'base64');
    if (!buffer.length) {
      return NextResponse.json(
        { error: { code: 'invalid_source', message: '文件为空或 base64 无效' } },
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
    const text = await extractDocumentText(buffer, body.filename, body.mediaType);
    return NextResponse.json({ text, chars: text.length, filename: body.filename });
  } catch (error) {
    return errorResponse(error);
  }
}
