import { NextResponse, type NextRequest } from 'next/server';
import { advanceCursorToLatest, setCursor } from '@/lib/worldbuilding/manuscript';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { z } from 'zod';

type Params = { params: Promise<{ worldId: string; manuscriptId: string }> };

const cursorSchema = z.object({ eventUid: z.string().nullable() });

/** 设置叙事进度光标；{eventUid:null→显式清除} 或 {"advance":true} 推进到最新事件。 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId, manuscriptId } = await params;
    const body = (await readJsonBody(request, MAX_JSON_REQUEST_BYTES)) as Record<string, unknown>;
    if (body?.advance === true) {
      return NextResponse.json({ manuscript: await advanceCursorToLatest(worldId, manuscriptId) });
    }
    const { eventUid } = cursorSchema.parse(body);
    return NextResponse.json({ manuscript: await setCursor(worldId, manuscriptId, eventUid) });
  } catch (error) {
    return errorResponse(error);
  }
}
