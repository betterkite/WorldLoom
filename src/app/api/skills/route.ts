import { NextResponse, type NextRequest } from 'next/server';
import { createSkill, listSkills } from '@/lib/skills/store';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';

export async function GET() {
  try {
    return NextResponse.json({ skills: await listSkills() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json(
      { skill: await createSkill(await readJsonBody(request, MAX_JSON_REQUEST_BYTES)) },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
