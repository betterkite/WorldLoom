import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/client';
import { importSkillMarkdown } from '@/lib/skills/import';
import {
  activateSkillRevision,
  createSkill,
  listSkillRevisions,
  updateSkill
} from '@/lib/skills/store';

describe('skills: immutable content revisions', () => {
  beforeEach(async () => {
    await prisma.skill.deleteMany();
  });

  it('creates an initial revision and appends a revision when content changes', async () => {
    const skill = await createSkill({
      name: 'revision-test',
      description: '第一版',
      instructions: '先读取世界设定。',
      target: 'assistant'
    });
    const updated = await updateSkill(skill.id, { instructions: '先读取世界设定，再检查时间线。' });
    const revisions = await listSkillRevisions(skill.id);

    expect(updated.version).toBe('1.0.1');
    expect(revisions.map((revision) => revision.version)).toEqual(['1.0.1', '1.0.0']);
    expect(revisions[0].instructions).toContain('时间线');
  });

  it('does not create a content revision for an enablement toggle', async () => {
    const skill = await createSkill({
      name: 'toggle-test',
      description: '启停',
      instructions: '保持启用状态。'
    });
    const updated = await updateSkill(skill.id, { enabled: false });
    const revisions = await listSkillRevisions(skill.id);

    expect(updated.enabled).toBe(false);
    expect(updated.version).toBe('1.0.0');
    expect(revisions).toHaveLength(1);
  });

  it('restores an old snapshot as a new audited version', async () => {
    const skill = await createSkill({
      name: 'rollback-test',
      description: '第一版',
      instructions: '使用第一套规则。'
    });
    await updateSkill(skill.id, {
      description: '第二版',
      instructions: '使用第二套规则。'
    });
    const revisions = await listSkillRevisions(skill.id);
    const initial = revisions.find((revision) => revision.version === '1.0.0');
    expect(initial).toBeDefined();

    const restored = await activateSkillRevision(skill.id, initial!.id);
    const afterRestore = await listSkillRevisions(skill.id);

    expect(restored.createdRevision).toBe(true);
    expect(restored.skill.version).toBe('1.0.2');
    expect(restored.skill.description).toBe('第一版');
    expect(afterRestore.map((revision) => revision.version)).toEqual(['1.0.2', '1.0.1', '1.0.0']);
    expect(afterRestore[0].restoredFromRevisionId).toBe(initial!.id);
  });

  it('imports a replacement as a new immutable revision', async () => {
    const first = await importSkillMarkdown({
      text: '---\nname: import-test\ndescription: 第一版\n---\n\n使用第一套规则。'
    });
    const second = await importSkillMarkdown({
      text: '---\nname: import-test\ndescription: 第二版\n---\n\n使用第二套规则。'
    });
    const revisions = await listSkillRevisions(first.skill.id);

    expect(second.created).toBe(false);
    expect(second.skill.version).toBe('1.0.1');
    expect(revisions.map((revision) => revision.description)).toEqual(['第二版', '第一版']);
  });
});
