import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse } from '@/lib/api';
import { activateSkillRevision } from '@/lib/skills/store';

type Params = { params: Promise<{ skillId: string; revisionId: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const { skillId, revisionId } = await params;
    return NextResponse.json(await activateSkillRevision(skillId, revisionId));
  } catch (error) {
    return errorResponse(error);
  }
}
