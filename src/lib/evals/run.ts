import { prisma } from '@/lib/db/client';
import { searchWorld } from '@/lib/retrieval/search';
import { requireWorld } from '@/lib/governance/changes';

/** P7-2 评测跑分：期望 uid 是否出现在检索结果中（含名次）。 */
export async function runEval(
  worldId: string,
  cases: { query: string; expectedUid: string; note?: string }[]
) {
  const world = await requireWorld(worldId);
  const results: {
    caseId: string;
    query: string;
    expectedUid: string;
    hit: boolean;
    rank: number | null;
    mode: 'lexical' | 'hybrid';
    semantic: {
      version: number;
      expected: number;
      indexed: number;
      coverage: number;
      fresh: boolean;
    };
  }[] = [];
  const modes = new Set<'lexical' | 'hybrid'>();
  for (const c of cases) {
    const search = await searchWorld(worldId, c.query, { topK: 10 });
    modes.add(search.mode);
    const rank = search.hits.findIndex((h) => h.uid === c.expectedUid);
    results.push({
      caseId: globalThis.crypto.randomUUID(),
      query: c.query,
      expectedUid: c.expectedUid,
      hit: rank >= 0,
      rank: rank >= 0 ? rank + 1 : null,
      mode: search.mode,
      semantic: {
        version: search.semantic.version,
        expected: search.semantic.expected,
        indexed: search.semantic.indexed,
        coverage: search.semantic.coverage,
        fresh: search.semantic.fresh
      }
    });
  }
  const score = results.length ? results.filter((r) => r.hit).length / results.length : 0;
  const mode = modes.size === 1 && modes.has('hybrid') ? 'hybrid' : 'lexical';
  const run = await prisma.evalRun.create({
    data: {
      worldId,
      version: world.masterVersion,
      mode,
      score: Number(score.toFixed(4)),
      results: results as object[]
    }
  });
  return { runId: run.id, version: run.version, mode, score: run.score, results };
}

export async function listEvalRuns(worldId: string) {
  await requireWorld(worldId);
  return prisma.evalRun.findMany({ where: { worldId }, orderBy: { createdAt: 'desc' }, take: 20 });
}

export async function createEvalCase(
  worldId: string,
  input: {
    kind?: 'retrieval' | 'answer';
    query: string;
    expectedUid?: string;
    rubric?: string;
    note?: string;
  }
) {
  await requireWorld(worldId);
  const kind = input.kind ?? 'retrieval';
  return prisma.evalCase.create({
    data: {
      worldId,
      kind,
      query: input.query,
      expectedUid: kind === 'answer' ? (input.expectedUid ?? '') : (input.expectedUid ?? ''),
      rubric: input.rubric ?? '',
      note: input.note ?? ''
    }
  });
}

export async function listEvalCases(worldId: string) {
  await requireWorld(worldId);
  return prisma.evalCase.findMany({ where: { worldId }, orderBy: { query: 'asc' } });
}
