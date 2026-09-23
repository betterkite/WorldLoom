import { NextResponse, type NextRequest } from 'next/server';
import { updateLintFinding } from '@/lib/governance/lint';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { z } from 'zod';

type Params = { params: Promise<{ worldId: string; findingId: string }> };

const patchSchema = z.object({ status: z.enum(['open', 'ignored', 'fixed']) });

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { worldId, findingId } = await params;
    const { status } = patchSchema.parse(await readJsonBody(request, MAX_JSON_REQUEST_BYTES));
    return NextResponse.json({ finding: await updateLintFinding(worldId, findingId, status) });
  } catch (error) {
    return errorResponse(error);
  }
}
