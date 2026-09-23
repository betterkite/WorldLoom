import { NextResponse, type NextRequest } from 'next/server';
import { commitGenesis } from '@/lib/worldbuilding/genesis';
import { requireWorld } from '@/lib/governance/changes';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { chat } from '@/lib/llm/client';
import { z } from 'zod';

type Params = { params: Promise<{ worldId: string }> };

const commitSchema = z.object({
  plan: z.unknown(), // the approved plan from /genesis/plan (re-validated inside)
  premise: z.string().min(1).max(5000),
  style: z.string().max(2000).optional()
});

/**
 * Genesis step 2: approved framework → full entity/event generation →
 * staged as one pending Change batch on the governance chain.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const world = await requireWorld(worldId);
    const { plan, premise, style } = commitSchema.parse(
      await readJsonBody(request, MAX_JSON_REQUEST_BYTES)
    );

    const result = await commitGenesis(
      chat,
      worldId,
      { name: world.name, premise, style: style ?? world.style },
      plan
    );
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
