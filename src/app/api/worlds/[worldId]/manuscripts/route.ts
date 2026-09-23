import { NextResponse, type NextRequest } from 'next/server';
import { createManuscript, listManuscripts } from '@/lib/worldbuilding/manuscript';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_MANUSCRIPT_REQUEST_BYTES } from '@/lib/intake/limits';
import { z } from 'zod';

type Params = { params: Promise<{ worldId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    return NextResponse.json({ manuscripts: await listManuscripts(worldId) });
  } catch (error) {
    if (error instanceof Error && error.message.includes('[import-diag]')) {
      console.error(error.message);
    }
    return errorResponse(error);
  }
}

const createSchema = z
  .object({
    title: z.string().min(1).max(200),
    synopsis: z.string().max(5000).optional(),
    chapters: z
      .array(
        z.object({
          title: z.string().max(200).nullable().optional(),
          content: z.string().min(1).max(2_000_000)
        })
      )
      .max(2000)
      .optional()
  })
  .superRefine((value, context) => {
    const totalCharacters = (value.chapters ?? []).reduce(
      (total, chapter) => total + chapter.content.length,
      0
    );
    if (totalCharacters > 3_000_000) {
      context.addIssue({
        code: 'custom',
        path: ['chapters'],
        message: '作品总文本超过 300 万字符，请分批导入'
      });
    }
  });

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const body = createSchema.parse(await readJsonBody(request, MAX_MANUSCRIPT_REQUEST_BYTES));
    return NextResponse.json(
      { manuscript: await createManuscript(worldId, body) },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
