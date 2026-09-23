import { exportWorldZip } from '@/lib/export/obsidian';
import { errorResponse } from '@/lib/api';

type Params = { params: Promise<{ worldId: string }> };

/** A6-1: Obsidian vault ZIP of the master version. RFC 5987 filename encoding. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { worldId } = await params;
    const result = await exportWorldZip(worldId);
    return new Response(new Uint8Array(result.buffer), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="vault.zip"; filename*=UTF-8''${encodeURIComponent(result.filename)}`
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
