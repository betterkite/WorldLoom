import { prisma } from '@/lib/db/client';
import { GovernanceError, requireWorld } from '@/lib/governance/changes';
import { newUid } from '@/lib/uid';

/** C-1 伏笔管理：埋设/回收/列出；未回收伏笔注入推演作为素材。 */

export async function listForeshadows(worldId: string, status: string | null = null) {
  await requireWorld(worldId);
  return prisma.foreshadow.findMany({
    where: { worldId, ...(status ? { status } : {}) },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }]
  });
}

export async function createForeshadow(
  worldId: string,
  input: { title: string; detail?: string; plantedEventUid?: string | null }
) {
  await requireWorld(worldId);
  const title = String(input.title ?? '').trim();
  if (!title) throw new GovernanceError('invalid_foreshadow', '伏笔标题必填');
  return prisma.foreshadow.create({
    data: {
      worldId,
      uid: newUid('fsh'),
      title: title.slice(0, 120),
      detail: String(input.detail ?? '').slice(0, 2000),
      plantedEventUid: input.plantedEventUid ?? null
    }
  });
}

export async function resolveForeshadow(
  worldId: string,
  foreshadowId: string,
  input: { status?: 'open' | 'resolved'; resolvedEventUid?: string | null; detail?: string }
) {
  const existing = await prisma.foreshadow.findUnique({ where: { id: foreshadowId } });
  if (!existing || existing.worldId !== worldId)
    throw new GovernanceError('foreshadow_not_found', '伏笔不存在');
  return prisma.foreshadow.update({
    where: { id: foreshadowId },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.resolvedEventUid !== undefined ? { resolvedEventUid: input.resolvedEventUid } : {}),
      ...(input.detail !== undefined ? { detail: input.detail.slice(0, 2000) } : {})
    }
  });
}

export async function deleteForeshadow(worldId: string, foreshadowId: string) {
  const existing = await prisma.foreshadow.findUnique({ where: { id: foreshadowId } });
  if (!existing || existing.worldId !== worldId)
    throw new GovernanceError('foreshadow_not_found', '伏笔不存在');
  await prisma.foreshadow.delete({ where: { id: foreshadowId } });
  return { id: foreshadowId, deleted: true };
}
