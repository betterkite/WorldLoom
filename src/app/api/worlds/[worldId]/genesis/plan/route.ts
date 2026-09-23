import { NextResponse, type NextRequest } from 'next/server';
import { planWorld } from '@/lib/worldbuilding/genesis';
import { requireWorld } from '@/lib/governance/changes';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { chat } from '@/lib/llm/client';
import { z } from 'zod';

type Params = { params: Promise<{ worldId: string }> };

const planSchema = z.object({
  premise: z.string().min(1).max(5000),
  style: z.string().max(2000).optional()
});

/**
 * Genesis step 1: premise → framework preview (LLM). Pure computation —
 * nothing touches the governance chain until /genesis/commit.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { worldId } = await params;
    const world = await requireWorld(worldId);
    const { premise, style } = planSchema.parse(
      await readJsonBody(request, MAX_JSON_REQUEST_BYTES)
    );

    const plan = await planWorld(chat, {
      name: world.name,
      premise,
      style: style ?? world.style
    });
    return NextResponse.json({ plan });
  } catch (error) {
    return errorResponse(error);
  }
}
