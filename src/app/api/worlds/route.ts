import { NextResponse, type NextRequest } from 'next/server';
import { createWorld, listWorlds } from '@/lib/worldbuilding/worlds';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { z } from 'zod';

export async function GET() {
  try {
    return NextResponse.json({ worlds: await listWorlds() });
  } catch (error) {
    return errorResponse(error);
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  premise: z.string().max(5000).optional(),
  style: z.string().max(2000).optional(),
  ingestMode: z.enum(['review', 'auto']).optional()
});

export async function POST(request: NextRequest) {
  try {
    const body = createSchema.parse(await readJsonBody(request, MAX_JSON_REQUEST_BYTES));
    const world = await createWorld(body);
    return NextResponse.json({ world }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
