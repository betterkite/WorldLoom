import { prisma } from '@/lib/db/client';
import { GovernanceError } from '@/lib/governance/changes';
import { z } from 'zod';

export const skillCreateSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string().min(1).max(300),
  instructions: z.string().min(1).max(5000),
  target: z.enum(['assistant', 'genesis', 'both']).default('both'),
  retrievalJson: z.string().max(2000).default('{}')
});

export const skillUpdateSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  description: z.string().min(1).max(300).optional(),
  instructions: z.string().min(1).max(5000).optional(),
  target: z.enum(['assistant', 'genesis', 'both']).optional(),
  retrievalJson: z.string().max(2000).optional(),
  enabled: z.boolean().optional()
});

function bump(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : `${version}.1`;
}

export async function listSkills() {
  return prisma.skill.findMany({ orderBy: [{ builtin: 'desc' }, { name: 'asc' }] });
}

export async function getSkill(skillId: string) {
  const skill = await prisma.skill.findUnique({ where: { id: skillId } });
  if (!skill) throw new GovernanceError('skill_not_found', 'Skill not found');
  return skill;
}

export async function listSkillRevisions(skillId: string) {
  await getSkill(skillId);
  return prisma.skillRevision.findMany({
    where: { skillId },
    orderBy: { createdAt: 'desc' }
  });
}

export async function activateSkillRevision(skillId: string, revisionId: string) {
  return prisma.$transaction(async (tx) => {
    const skill = await tx.skill.findUnique({ where: { id: skillId } });
    if (!skill) throw new GovernanceError('skill_not_found', 'Skill not found');
    if (skill.builtin) {
      throw new GovernanceError('skill_builtin', 'Builtin skills cannot be rolled back');
    }

    const revision = await tx.skillRevision.findFirst({
      where: { id: revisionId, skillId }
    });
    if (!revision)
      throw new GovernanceError('skill_revision_not_found', 'Skill revision not found');

    const contentMatches =
      skill.description === revision.description &&
      skill.instructions === revision.instructions &&
      skill.retrievalJson === revision.retrievalJson &&
      skill.target === revision.target;
    if (contentMatches) {
      return {
        skill,
        revision,
        restoredFromRevisionId: revision.id,
        createdRevision: false
      };
    }

    const version = bump(skill.version);
    const updatedSkill = await tx.skill.update({
      where: { id: skillId },
      data: {
        description: revision.description,
        instructions: revision.instructions,
        retrievalJson: revision.retrievalJson,
        target: revision.target,
        version
      }
    });
    const release = await tx.skillRevision.create({
      data: revisionData({
        skillId,
        version,
        description: revision.description,
        instructions: revision.instructions,
        retrievalJson: revision.retrievalJson,
        target: revision.target,
        restoredFromRevisionId: revision.id
      })
    });

    return {
      skill: updatedSkill,
      revision: release,
      restoredFromRevisionId: revision.id,
      createdRevision: true
    };
  });
}

function revisionData(input: {
  skillId: string;
  version: string;
  description: string;
  instructions: string;
  retrievalJson: string;
  target: string;
  restoredFromRevisionId?: string;
}) {
  return {
    skillId: input.skillId,
    version: input.version,
    description: input.description,
    instructions: input.instructions,
    retrievalJson: input.retrievalJson,
    target: input.target,
    ...(input.restoredFromRevisionId
      ? { restoredFromRevisionId: input.restoredFromRevisionId }
      : {})
  };
}

export async function createSkill(input: unknown) {
  const data = skillCreateSchema.parse(input);
  try {
    return await prisma.skill.create({
      data: {
        ...data,
        version: '1.0.0',
        revisions: {
          create: {
            version: '1.0.0',
            description: data.description,
            instructions: data.instructions,
            retrievalJson: data.retrievalJson,
            target: data.target
          }
        }
      }
    });
  } catch {
    throw new GovernanceError('skill_exists', `Skill name already exists: ${data.name}`);
  }
}

export async function updateSkill(skillId: string, input: unknown) {
  const existing = await prisma.skill.findUnique({ where: { id: skillId } });
  if (!existing) throw new GovernanceError('skill_not_found', 'Skill not found');
  const partial = skillUpdateSchema.parse(input);
  const contentChanged = ['description', 'instructions', 'retrievalJson', 'target'].some(
    (key) => key in partial
  );
  if (!contentChanged) return prisma.skill.update({ where: { id: skillId }, data: partial });

  const version = bump(existing.version);
  return prisma.$transaction(async (tx) => {
    const skill = await tx.skill.update({
      where: { id: skillId },
      data: { ...partial, version }
    });
    await tx.skillRevision.create({
      data: revisionData({
        skillId: skill.id,
        version: skill.version,
        description: skill.description,
        instructions: skill.instructions,
        retrievalJson: skill.retrievalJson,
        target: skill.target
      })
    });
    return skill;
  });
}

export async function deleteSkill(skillId: string) {
  const existing = await prisma.skill.findUnique({ where: { id: skillId } });
  if (!existing) throw new GovernanceError('skill_not_found', 'Skill not found');
  if (existing.builtin)
    throw new GovernanceError('skill_builtin', 'Builtin skills cannot be deleted');
  await prisma.skill.delete({ where: { id: skillId } });
  return { id: skillId, deleted: true };
}
