import { prisma } from '@/lib/db/client';
import { GovernanceError } from '@/lib/governance/changes';
import { skillCreateSchema } from './store';

/**
 * C-5 SKILL.md 技能包导入：YAML frontmatter（name/description/target/retrieval）
 * + 正文作为 instructions；同名技能按语义版本递增导入。
 */

export function parseSkillMarkdown(text: string) {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]+)$/.exec(String(text ?? ''));
  if (!match)
    throw new GovernanceError(
      'invalid_skill_markdown',
      'SKILL.md 需要 frontmatter（--- 包裹）与正文'
    );
  const metadata: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        metadata[key] = JSON.parse(value);
        continue;
      } catch {
        /* 保留原字符串 */
      }
    }
    metadata[key] = value;
  }
  return {
    name: String(metadata.name ?? ''),
    description: String(metadata.description ?? ''),
    target: (metadata.target as string) ?? 'both',
    retrievalJson: metadata.retrieval ? JSON.stringify(metadata.retrieval) : '{}',
    instructions: match[2].trim()
  };
}

export async function importSkillMarkdown(input: { text: string; filename?: string }) {
  const parsed = parseSkillMarkdown(input.text);
  const payload = skillCreateSchema.parse({
    name: parsed.name,
    description: parsed.description || `导入自 ${input.filename ?? 'SKILL.md'}`,
    instructions: parsed.instructions,
    target: parsed.target,
    retrievalJson: parsed.retrievalJson
  });
  const existing = await prisma.skill.findUnique({ where: { name: payload.name } });
  if (!existing) {
    return {
      created: true,
      skill: await prisma.skill.create({
        data: {
          ...payload,
          version: '1.0.0',
          revisions: {
            create: {
              version: '1.0.0',
              description: payload.description,
              instructions: payload.instructions,
              retrievalJson: payload.retrievalJson,
              target: payload.target
            }
          }
        }
      })
    };
  }
  const bump = /^(\d+)\.(\d+)\.(\d+)$/.exec(existing.version);
  const version = bump ? `${bump[1]}.${bump[2]}.${Number(bump[3]) + 1}` : `${existing.version}.1`;
  const skill = await prisma.$transaction(async (tx) => {
    const updated = await tx.skill.update({
      where: { id: existing.id },
      data: { ...payload, version }
    });
    await tx.skillRevision.create({
      data: {
        skillId: updated.id,
        version: updated.version,
        description: updated.description,
        instructions: updated.instructions,
        retrievalJson: updated.retrievalJson,
        target: updated.target
      }
    });
    return updated;
  });
  return {
    created: false,
    skill
  };
}
