import { NextResponse } from 'next/server';
import { buildGameBundle } from '@/lib/export/game-json';
import { errorResponse } from '@/lib/api';

type Params = { params: Promise<{ worldId: string }> };

/** C-3 游戏引擎 JSON 导出（内联返回；?download=1 时作为附件）。 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { worldId } = await params;
    const bundle = await buildGameBundle(worldId);
    const download = new URL(request.url).searchParams.get('download') === '1';
    const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
    if (download) {
      const filename = `${bundle.world.name.replace(/[\\/:*?"<>|]+/g, '-')}-v${bundle.world.masterVersion}.json`;
      headers['content-disposition'] =
        `attachment; filename="world.json"; filename*=UTF-8''${encodeURIComponent(filename)}`;
    }
    return new NextResponse(JSON.stringify(bundle, null, 2), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
