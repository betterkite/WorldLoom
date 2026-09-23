import { NextResponse, type NextRequest } from 'next/server';
import { deleteSkill, getSkill, listSkillRevisions, updateSkill } from '@/lib/skills/store';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';

type Params = { params: Promise<{ skillId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { skillId } = await params;
    return NextResponse.json({
      skill: await getSkill(skillId),
      revisions: await listSkillRevisions(skillId)
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { skillId } = await params;
    return NextResponse.json({
      skill: await updateSkill(skillId, await readJsonBody(request, MAX_JSON_REQUEST_BYTES))
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { skillId } = await params;
    return NextResponse.json(await deleteSkill(skillId));
  } catch (error) {
    return errorResponse(error);
  }
}
