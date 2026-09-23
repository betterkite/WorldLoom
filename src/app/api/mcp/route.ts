import { NextResponse, type NextRequest } from 'next/server';
import { handleMcpRequest } from '@/lib/mcp/server';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_MCP_REQUEST_BYTES } from '@/lib/intake/limits';

/** MCP JSON-RPC endpoint (A6-2). */
export async function POST(request: NextRequest) {
  try {
    const body = (await readJsonBody(request, MAX_MCP_REQUEST_BYTES)) as Parameters<
      typeof handleMcpRequest
    >[0];
    if (!body?.method) {
      return NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } },
        { status: 400 }
      );
    }
    return NextResponse.json(await handleMcpRequest(body));
  } catch (error) {
    return errorResponse(error);
  }
}
