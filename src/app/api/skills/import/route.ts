import { NextResponse, type NextRequest } from 'next/server';
import { importSkillMarkdown } from '@/lib/skills/import';
import { errorResponse, readJsonBody } from '@/lib/api';
import { MAX_JSON_REQUEST_BYTES } from '@/lib/intake/limits';
import { z } from 'zod';

const schema = z.object({
  text: z.string().min(10).max(100_000),
  filename: z.string().max(200).optional()
});

/** C-5：导入 SKILL.md（frontmatter + 指令正文），同名技能递增版本。 */
export async function POST(request: NextRequest) {
  try {
    return NextResponse.json(
      await importSkillMarkdown(
        z.parse(schema, await readJsonBody(request, MAX_JSON_REQUEST_BYTES))
      ),
      {
        status: 201
      }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
