import { prisma } from '@/lib/db/client';
import { requireWorld } from '@/lib/governance/changes';
import {
  getSemanticIndexJob,
  getSemanticIndexStatus,
  runSemanticIndexJob,
  SEMANTIC_JOB_STALE_MS
} from '@/lib/retrieval/search';

/** P7-4 业务知识：LLM 输出数据契约（与 src/lib/worldbuilding/contracts.ts 一一对应）。 */
export const DATA_CONTRACTS = [
  {
    id: 'genesis_plan',
    name: '创世框架预览',
    usedBy: 'POST /genesis/plan',
    fields: 'premiseExpanded, tone, epochs[{name,description}], factions[], regions[], threads[]',
    tolerance: '字段缺失回落默认值；不写入任何正史数据'
  },
  {
    id: 'generated_world',
    name: '世界增量（创世/编译共用）',
    usedBy: 'genesis/commit · sources/[id]/compile · chapters/finalize',
    fields:
      'epochs[{name,order}], entities[{kind,name,confidence}], events[{title,epochName,year,participants[],causes[]}], relations[{subject,object,relation,polarity}]',
    tolerance:
      '关系名自由文本；polarity 未知回落 establish；confidence 未知回落 INFERRED；名称引用由 stager 解析为 uid，解析失败记缺陷跳过'
  },
  {
    id: 'continuation_candidates',
    name: '推演候选',
    usedBy: 'POST /continuations',
    fields:
      'candidates[{kind,title,summary,epochName,year,participants[],relation{...},rationale}]',
    tolerance: '≤5 条；采纳时才解析名称并提交 Change'
  },
  {
    id: 'change_payload',
    name: '变更载荷（staging 权威）',
    usedBy: '所有写入路径的最终校验（governance/schemas.ts）',
    fields:
      'entity: {kind,name,confidence,tags[],sourceRefs[]} · event: {title,epochUid,epochYear,causeUids[],effectUids[]}',
    tolerance: '无——载荷不合法直接拒绝，正史只接受完整校验的变更'
  }
];

/** P7-3 运行治理：单世界运行健康聚合（摄入/审阅/Lint/推演/问答/版本）。 */
export async function getRunHealth(worldId: string) {
  const world = await requireWorld(worldId);
  const v = world.masterVersion;
  const since7d = new Date(Date.now() - 7 * 86_400_000);

  const [
    sourcesTotal,
    sourcesStaged,
    sourcesCompiled,
    sourcesFailed,
    changesPending,
    changesMerged,
    lintError,
    lintWarning,
    lintIgnored,
    continuationsPending,
    qa7d,
    qaTotal,
    manuscripts,
    chaptersDraft,
    chaptersFinal,
    failedSources,
    recentVersions
  ] = await Promise.all([
    prisma.source.count({ where: { worldId } }),
    prisma.source.count({ where: { worldId, status: 'staged' } }),
    prisma.source.count({ where: { worldId, status: 'compiled' } }),
    prisma.source.count({ where: { worldId, status: 'failed' } }),
    prisma.change.count({ where: { worldId, status: 'pending' } }),
    prisma.change.count({ where: { worldId, status: 'merged' } }),
    prisma.lintFinding.count({ where: { worldId, version: v, status: 'open', severity: 'error' } }),
    prisma.lintFinding.count({
      where: { worldId, version: v, status: 'open', severity: 'warning' }
    }),
    prisma.lintFinding.count({ where: { worldId, version: v, status: 'ignored' } }),
    prisma.continuation.count({ where: { worldId, status: 'pending' } }),
    prisma.qaRecord.count({ where: { worldId, createdAt: { gte: since7d } } }),
    prisma.qaRecord.count({ where: { worldId } }),
    prisma.manuscript.count({ where: { worldId } }),
    prisma.chapter.count({ where: { manuscript: { worldId }, status: 'draft' } }),
    prisma.chapter.count({ where: { manuscript: { worldId }, status: 'final' } }),
    prisma.source.findMany({
      where: { worldId, status: 'failed' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, filename: true, createdAt: true }
    }),
    prisma.worldVersion.findMany({
      where: { worldId },
      orderBy: { version: 'desc' },
      take: 3,
      select: { version: true, summary: true, createdAt: true }
    })
  ]);
  const health =
    sourcesFailed === 0 && lintError === 0 ? 'healthy' : lintError > 0 ? 'attention' : 'ok';
  const semanticIndex = await getSemanticIndexStatus(worldId);
  const semanticIndexJob = await getSemanticIndexJob(worldId, v);
  const jobResumable =
    semanticIndexJob?.status === 'queued' ||
    (semanticIndexJob?.status === 'running' &&
      Date.now() - (semanticIndexJob.lastHeartbeatAt?.getTime() ?? 0) >= SEMANTIC_JOB_STALE_MS);
  if (jobResumable && process.env.NODE_ENV !== 'test') {
    void runSemanticIndexJob(semanticIndexJob.id);
  }
  return {
    worldId,
    masterVersion: v,
    health,
    intake: {
      total: sourcesTotal,
      staged: sourcesStaged,
      compiled: sourcesCompiled,
      failed: sourcesFailed,
      failedList: failedSources
    },
    review: { pending: changesPending, merged: changesMerged },
    lint: { error: lintError, warning: lintWarning, ignored: lintIgnored },
    continuation: { pending: continuationsPending },
    qa: { last7d: qa7d, total: qaTotal },
    studio: { manuscripts, chaptersDraft, chaptersFinal },
    semanticIndex,
    semanticIndexJob,
    recentVersions
  };
}

/** 编译器产出统计（按作者分组）——契约运行的活证据。 */
export async function getContractStats(worldId: string) {
  const grouped = await prisma.change.groupBy({
    by: ['author'],
    where: { worldId },
    _count: { _all: true }
  });
  return grouped.map((row) => ({ author: row.author, changes: row['_count']['_all'] }));
}
