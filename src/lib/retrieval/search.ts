import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { tokenize, cosine } from './tokenizer';
import { embed as defaultEmbed, EmbeddingError } from '@/lib/llm/embeddings';
import { getEmbeddingsConfig, isSemanticEnabled } from '@/lib/llm/config';
import { contentHash } from './tokenizer';

/**
 * Hybrid retrieval:
 *   lexical: CJK-bigram BM25 over entity/event text (in-process scoring —
 *            index upgrade deferred until scale demands it)
 *   dense:   pgvector cosine over semantic_vectors (optional; needs an
 *            embeddings endpoint — otherwise pure lexical, honestly degraded)
 *   fusion:  Reciprocal Rank Fusion (k=60) → graph-degree pseudo-rerank
 */

export interface SearchHit {
  kind: 'entity' | 'event' | 'relation';
  uid: string;
  name: string;
  kindLabel: string;
  summary: string;
  score: number;
  lexicalScore: number;
  denseScore: number;
}

export interface SearchResult {
  mode: 'hybrid' | 'lexical';
  query: string;
  hits: SearchHit[];
  semantic: SemanticIndexStatus;
}

export interface SemanticIndexStatus {
  version: number;
  expected: number;
  indexed: number;
  coverage: number;
  fresh: boolean;
  lastIndexedAt: string | null;
  embeddingModel: string | null;
  reason:
    | 'not_requested'
    | 'disabled_by_request'
    | 'semantic_unconfigured'
    | 'no_targets'
    | 'no_index'
    | 'stale_index'
    | 'embedding_error'
    | null;
}

const SEMANTIC_COVERAGE_THRESHOLD = 0.8;

interface Target {
  kind: 'entity' | 'event' | 'relation';
  uid: string;
  name: string;
  kindLabel: string;
  summary: string;
  content: string;
}

interface SemanticVectorRow {
  target_key: string;
  content_hash: string;
  embedding: string | null;
  embedding_model: string | null;
  updated_at: string;
}

export async function searchWorld(
  worldId: string,
  query: string,
  options: { topK?: number; useSemantic?: boolean; embedFn?: typeof defaultEmbed } = {}
): Promise<SearchResult> {
  const embed = options.embedFn ?? defaultEmbed;
  const world = await prisma.world.findUnique({ where: { id: worldId } });
  if (!world) throw new Error(`World not found: ${worldId}`);
  const v = world.masterVersion;
  const topK = Math.min(20, Math.max(1, options.topK ?? 8));

  const [entities, events, relations] = await Promise.all([
    prisma.entity.findMany({ where: { worldId, version: v } }),
    prisma.chronicleEvent.findMany({ where: { worldId, version: v } }),
    prisma.relationshipEvent.findMany({ where: { worldId, version: v } })
  ]);
  const entityById = new Map(entities.map((entity) => [entity.uid, entity]));
  const eventById = new Map(events.map((event) => [event.uid, event]));

  const targets: Target[] = [
    ...entities.map((entity) => ({
      kind: 'entity' as const,
      uid: entity.uid,
      name: entity.name,
      kindLabel: entity.kind,
      summary: entity.summary,
      content: `${entity.name}\n${entity.summary}\n${entity.content}`
    })),
    ...events.map((event) => ({
      kind: 'event' as const,
      uid: event.uid,
      name: event.title,
      kindLabel: 'event',
      summary: event.summary,
      content: `${event.title}\n${event.summary}\n${event.content}`
    })),
    // B-6: 关系快照也是可召回的世界事实（否则「师徒关系」类问题无法引用）
    ...relations.map((relation) => {
      const subject = entityById.get(relation.subjectUid);
      const object = entityById.get(relation.objectUid);
      const anchor = relation.eventUid ? eventById.get(relation.eventUid) : null;
      const state = relation.polarity === 'terminate' ? '终止' : relation.polarity;
      const name = `${subject?.name ?? relation.subjectUid} 与 ${object?.name ?? relation.objectUid} 的${relation.relation}关系`;
      const summary = [
        anchor ? `发生于「${anchor.title}」` : '基础关系',
        `状态：${state}`,
        relation.note
      ]
        .filter(Boolean)
        .join(' · ');
      return {
        kind: 'relation' as const,
        uid: relation.uid,
        name,
        kindLabel: 'relation',
        summary,
        content: `${name}\n${summary}\n${subject?.summary ?? ''}\n${object?.summary ?? ''}`
      };
    })
  ];

  // ---- lexical: bigram BM25 ----
  const queryTokens = tokenize(query);
  const docsTokens = targets.map((target) => new Set(tokenize(target.content)));
  const documentFrequency = new Map<string, number>();
  for (const tokens of docsTokens) {
    for (const token of tokens)
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  const N = targets.length;
  const lexicalScores = targets.map((_, index) => {
    if (queryTokens.length === 0) return 0;
    let bm25 = 0;
    for (const token of queryTokens) {
      const df = documentFrequency.get(token) ?? 0;
      if (df === 0) continue;
      const tf = docsTokens[index].has(token) ? 1 : 0; // set-based tf (title+summary weighted via duplication in content)
      if (tf === 0) continue;
      bm25 += Math.log(1 + (N - df + 0.5) / (df + 0.5)) * ((tf * 2.2) / (tf + 1.2));
    }
    return 1 - Math.exp(-bm25 / 4);
  });

  // ---- dense: pgvector cosine (optional) ----
  let denseScores: (number | null)[] = targets.map(() => null);
  let mode: 'hybrid' | 'lexical' = 'lexical';
  let semantic: SemanticIndexStatus = {
    version: v,
    expected: targets.length,
    indexed: 0,
    coverage: 0,
    fresh: false,
    lastIndexedAt: null,
    embeddingModel: getEmbeddingsConfig()?.model ?? null,
    reason: 'not_requested'
  };
  // useSemantic===true forces the semantic path (tests / explicit opt-in);
  // undefined → config-driven; false → lexical only.
  const semanticActive =
    options.useSemantic === true
      ? true
      : options.useSemantic === false
        ? false
        : isSemanticEnabled();
  if (options.useSemantic === false) semantic.reason = 'disabled_by_request';
  else if (!semanticActive) semantic.reason = 'semantic_unconfigured';
  if (semanticActive && targets.length === 0) semantic.reason = 'no_targets';
  if (semanticActive && targets.length > 0) {
    try {
      const ids = targets.map((target) => `${target.kind}:${target.uid}`);
      const stored = await prisma.$queryRaw<SemanticVectorRow[]>`
        SELECT target_kind || ':' || "targetUid" AS target_key,
          content_hash, embedding::text AS embedding, "embeddingModel" AS embedding_model,
          updated_at::text AS updated_at
        FROM semantic_vectors WHERE "worldId" = ${worldId} AND version = ${v}`;
      const configuredModel = getEmbeddingsConfig()?.model ?? null;
      const customEmbed = options.embedFn !== undefined && options.embedFn !== defaultEmbed;
      const expectedHashes = new Map(
        targets.map((target) => [`${target.kind}:${target.uid}`, contentHash(target.content)])
      );
      const freshRows = stored.filter(
        (row) =>
          row.embedding &&
          expectedHashes.get(row.target_key) === row.content_hash &&
          (customEmbed || row.embedding_model === configuredModel)
      );
      const coverage = freshRows.length / targets.length;
      semantic = {
        version: v,
        expected: targets.length,
        indexed: freshRows.length,
        coverage: Number(coverage.toFixed(4)),
        fresh: coverage >= SEMANTIC_COVERAGE_THRESHOLD,
        lastIndexedAt:
          stored
            .map((row) => row.updated_at)
            .filter(Boolean)
            .toSorted()
            .at(-1) ?? null,
        embeddingModel: configuredModel,
        reason:
          stored.length === 0
            ? 'no_index'
            : coverage >= SEMANTIC_COVERAGE_THRESHOLD
              ? null
              : 'stale_index'
      };
      if (semantic.fresh) {
        const [queryVector] = await embed([query]);
        const vectorByTarget = new Map(
          freshRows.map((row) => [row.target_key, JSON.parse(row.embedding!) as number[]])
        );
        denseScores = targets.map((_, index) => {
          const vector = vectorByTarget.get(ids[index]);
          return vector ? Math.max(0, cosine(queryVector, vector)) : 0;
        });
        mode = 'hybrid';
      }
    } catch (error) {
      if (!(error instanceof EmbeddingError)) throw error;
      // honest degradation: configured endpoint failed → lexical only
      mode = 'lexical';
      semantic = { ...semantic, fresh: false, reason: 'embedding_error' };
    }
  }

  // ---- RRF fusion (k=60) ----
  const k = 60;
  const lexicalRank = rankBy(lexicalScores);
  const denseRank =
    mode === 'hybrid' ? rankBy(denseScores.map((score) => score ?? 0)) : new Map<number, number>();
  const fused = targets.map((_, index) => {
    const lexicalContribution = lexicalRank.has(index)
      ? 1 / (k + (lexicalRank.get(index) as number))
      : 0;
    const denseContribution = denseRank.has(index) ? 1 / (k + (denseRank.get(index) as number)) : 0;
    const semanticWeight = mode === 'hybrid' ? 1 : 0;
    return {
      index,
      score: lexicalContribution + semanticWeight * denseContribution,
      lexicalScore: lexicalScores[index],
      denseScore: denseScores[index] ?? 0
    };
  });

  // ---- graph-degree pseudo-rerank (tie-break only, ADR-013) ----
  const degree = await graphDegrees(worldId, v);
  fused.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-6) return b.score - a.score;
    return (degree.get(targets[b.index].uid) ?? 0) - (degree.get(targets[a.index].uid) ?? 0);
  });

  // ---- wikilink/因果 multi-hop (ADR-014): append event-edge neighbours of
  // top event hits as expansion evidence (max 2, no score inflation) ----
  const selected = fused.filter((item) => item.score > 0).slice(0, topK);
  const selectedEventUids = selected
    .filter((item) => targets[item.index].kind === 'event')
    .map((item) => targets[item.index].uid);
  if (selectedEventUids.length > 0) {
    const edges = await prisma.eventEdge.findMany({
      where: {
        worldId,
        version: v,
        OR: selectedEventUids.flatMap((uid) => [{ causeUid: uid }, { effectUid: uid }])
      }
    });
    const neighbours = new Set<string>();
    for (const edge of edges) {
      const known = new Set(selectedEventUids);
      if (known.has(edge.causeUid)) neighbours.add(edge.effectUid);
      if (known.has(edge.effectUid)) neighbours.add(edge.causeUid);
    }
    for (const neighbourUid of [...neighbours].slice(0, 2)) {
      if (selected.some((item) => targets[item.index].uid === neighbourUid)) continue;
      const neighbourIndex = targets.findIndex((target) => target.uid === neighbourUid);
      if (neighbourIndex >= 0)
        selected.push({ index: neighbourIndex, score: 0.001, lexicalScore: 0, denseScore: 0 });
    }
  }

  const hits: SearchHit[] = selected.map((item) => ({
    kind: targets[item.index].kind,
    uid: targets[item.index].uid,
    name: targets[item.index].name,
    kindLabel: targets[item.index].kindLabel,
    summary: targets[item.index].summary,
    score: Number(item.score.toFixed(5)),
    lexicalScore: Number(item.lexicalScore.toFixed(5)),
    denseScore: Number((item.denseScore ?? 0).toFixed(5))
  }));

  return { mode, query, hits, semantic };
}

/** Return index freshness without making an embedding-provider call. */
export async function getSemanticIndexStatus(worldId: string): Promise<SemanticIndexStatus> {
  const world = await prisma.world.findUnique({ where: { id: worldId } });
  if (!world) throw new Error(`World not found: ${worldId}`);
  const [entities, events, relations, stored] = await Promise.all([
    prisma.entity.findMany({ where: { worldId, version: world.masterVersion } }),
    prisma.chronicleEvent.findMany({ where: { worldId, version: world.masterVersion } }),
    prisma.relationshipEvent.findMany({ where: { worldId, version: world.masterVersion } }),
    prisma.$queryRaw<SemanticVectorRow[]>`
      SELECT target_key, content_hash, embedding::text AS embedding,
        "embeddingModel" AS embedding_model, updated_at::text AS updated_at
      FROM (
        SELECT target_kind || ':' || "targetUid" AS target_key,
          content_hash, embedding, "embeddingModel", updated_at
        FROM semantic_vectors
        WHERE "worldId" = ${worldId} AND version = ${world.masterVersion}
      ) indexed`
  ]);
  const configuredModel = getEmbeddingsConfig()?.model ?? null;
  const entityById = new Map(entities.map((entity) => [entity.uid, entity]));
  const eventById = new Map(events.map((event) => [event.uid, event]));
  const expectedHashes = new Map<string, string>([
    ...entities.map(
      (entity) =>
        [
          `entity:${entity.uid}`,
          contentHash(`${entity.name}\n${entity.summary}\n${entity.content}`)
        ] as const
    ),
    ...events.map(
      (event) =>
        [
          `event:${event.uid}`,
          contentHash(`${event.title}\n${event.summary}\n${event.content}`)
        ] as const
    ),
    ...relations.map((relation) => {
      const subject = entityById.get(relation.subjectUid);
      const object = entityById.get(relation.objectUid);
      const anchor = relation.eventUid ? eventById.get(relation.eventUid) : null;
      const name = `${subject?.name ?? relation.subjectUid} 与 ${object?.name ?? relation.objectUid} 的${relation.relation}关系`;
      const summary = [
        anchor ? `发生于「${anchor.title}」` : '基础关系',
        `状态：${relation.polarity === 'terminate' ? '终止' : relation.polarity}`,
        relation.note
      ]
        .filter(Boolean)
        .join(' · ');
      return [
        `relation:${relation.uid}`,
        contentHash(`${name}\n${summary}\n${subject?.summary ?? ''}\n${object?.summary ?? ''}`)
      ] as const;
    })
  ]);
  const expected = expectedHashes.size;
  const fresh = stored.filter(
    (row) =>
      row.embedding &&
      expectedHashes.get(row.target_key) === row.content_hash &&
      row.embedding_model === configuredModel
  ).length;
  const coverage = expected ? fresh / expected : 0;
  return {
    version: world.masterVersion,
    expected,
    indexed: fresh,
    coverage: Number(coverage.toFixed(4)),
    fresh: expected > 0 && coverage >= SEMANTIC_COVERAGE_THRESHOLD,
    embeddingModel: configuredModel,
    lastIndexedAt:
      stored
        .map((row) => row.updated_at)
        .filter(Boolean)
        .toSorted()
        .at(-1) ?? null,
    reason:
      expected === 0
        ? 'no_targets'
        : !configuredModel
          ? 'semantic_unconfigured'
          : stored.length === 0
            ? 'no_index'
            : coverage >= SEMANTIC_COVERAGE_THRESHOLD
              ? null
              : 'stale_index'
  };
}

function rankBy(scores: number[]): Map<number, number> {
  return new Map(
    [...scores.keys()]
      .toSorted((a, b) => scores[b] - scores[a])
      .filter((index) => scores[index] > 0)
      .map((index, position) => [index, position + 1])
  );
}

async function graphDegrees(worldId: string, version: number): Promise<Map<string, number>> {
  const [edges, events] = await Promise.all([
    prisma.eventEdge.findMany({ where: { worldId, version } }),
    prisma.chronicleEvent.findMany({
      where: { worldId, version },
      select: { participantUids: true }
    })
  ]);
  const degree = new Map<string, number>();
  const bump = (uid: string) => degree.set(uid, (degree.get(uid) ?? 0) + 1);
  for (const edge of edges) {
    bump(edge.causeUid);
    bump(edge.effectUid);
  }
  for (const participants of events.map((e) => e.participantUids)) {
    for (const participant of participants) bump(participant);
  }
  return degree;
}

/** (Re-)embed all entity/event/relation texts of a world version into semantic_vectors. */
export async function indexWorldSemantic(
  worldId: string,
  embedFn: (texts: string[]) => Promise<number[][]> = defaultEmbed,
  options: { version?: number; onProgress?: () => Promise<void> } = {}
): Promise<{ indexed: number; skipped: boolean; reason?: string }> {
  if (embedFn === defaultEmbed && !isSemanticEnabled())
    return { indexed: 0, skipped: true, reason: 'semantic retrieval is not enabled/configured' };
  const world = await prisma.world.findUnique({ where: { id: worldId } });
  if (!world) throw new Error(`World not found: ${worldId}`);
  const v = options.version ?? world.masterVersion;

  const [entities, events, relations] = await Promise.all([
    prisma.entity.findMany({ where: { worldId, version: v } }),
    prisma.chronicleEvent.findMany({ where: { worldId, version: v } }),
    prisma.relationshipEvent.findMany({ where: { worldId, version: v } })
  ]);
  const entityById = new Map(entities.map((entity) => [entity.uid, entity]));
  const eventById = new Map(events.map((event) => [event.uid, event]));
  const relationTargets = relations.map((relation) => {
    const subject = entityById.get(relation.subjectUid);
    const object = entityById.get(relation.objectUid);
    const anchor = relation.eventUid ? eventById.get(relation.eventUid) : null;
    const name = `${subject?.name ?? relation.subjectUid} 与 ${object?.name ?? relation.objectUid} 的${relation.relation}关系`;
    const summary = [
      anchor ? `发生于「${anchor.title}」` : '基础关系',
      `状态：${relation.polarity === 'terminate' ? '终止' : relation.polarity}`,
      relation.note
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      kind: 'relation' as const,
      uid: relation.uid,
      text: `${name}\n${summary}\n${subject?.summary ?? ''}\n${object?.summary ?? ''}`
    };
  });
  const targets: { kind: 'entity' | 'event' | 'relation'; uid: string; text: string }[] = [
    ...entities.map((entity) => ({
      kind: 'entity' as const,
      uid: entity.uid,
      text: `${entity.name}\n${entity.summary}\n${entity.content}`
    })),
    ...events.map((event) => ({
      kind: 'event' as const,
      uid: event.uid,
      text: `${event.title}\n${event.summary}\n${event.content}`
    })),
    ...relationTargets
  ];
  if (targets.length === 0) return { indexed: 0, skipped: true, reason: 'no content' };

  await options.onProgress?.();
  const vectors = await embedFn(targets.map((target) => target.text));
  const currentWorld = await prisma.world.findUnique({
    where: { id: worldId },
    select: { masterVersion: true }
  });
  if (!currentWorld || currentWorld.masterVersion !== v) {
    return { indexed: 0, skipped: true, reason: 'world_deleted_or_superseded' };
  }
  const dims = vectors[0]?.length ?? 0;
  const embeddingModel =
    embedFn === defaultEmbed ? (getEmbeddingsConfig()?.model ?? null) : 'custom-test';
  for (let i = 0; i < targets.length; i += 1) {
    const hash = contentHash(targets[i].text);
    try {
      await prisma.$executeRaw`
        INSERT INTO semantic_vectors (id, "worldId", version, target_kind, "targetUid", content_hash, dims, embedding, "embeddingModel")
        VALUES (${`sv_${targets[i].kind}_${targets[i].uid}`}, ${worldId}, ${v}, ${targets[i].kind}, ${targets[i].uid}, ${hash}, ${dims},
          ${`[${vectors[i].join(',')}]`}::vector, ${embeddingModel})
        ON CONFLICT (id) DO UPDATE SET
          embedding = excluded.embedding, content_hash = excluded.content_hash,
          dims = excluded.dims, version = excluded.version,
          "embeddingModel" = excluded."embeddingModel", updated_at = now()`;
    } catch (error) {
      // A world can be deleted while this detached background job is embedding.
      // Treat PostgreSQL's FK violation as cancellation, not as a provider failure.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        return { indexed: i, skipped: true, reason: 'world_deleted_or_superseded' };
      }
      throw error;
    }
    await options.onProgress?.();
  }
  return { indexed: targets.length, skipped: false };
}

export const SEMANTIC_JOB_STALE_MS = 120_000;

function semanticJobErrorMessage(error: unknown) {
  if (error instanceof EmbeddingError) {
    return `${error.code}${error.status ? ` (${error.status})` : ''}`;
  }
  return 'semantic_index_failed';
}

/** Enqueue one durable refresh for a specific immutable world version. */
export async function enqueueSemanticIndex(worldId: string, version: number) {
  if (!isSemanticEnabled()) return null;
  const world = await prisma.world.findUnique({ where: { id: worldId }, select: { id: true } });
  if (!world) throw new Error(`World not found: ${worldId}`);

  const existing = await prisma.semanticIndexJob.findUnique({
    where: { worldId_version: { worldId, version } }
  });
  if (existing && (existing.status === 'queued' || existing.status === 'completed')) {
    return existing;
  }
  if (existing && existing.status === 'running') {
    const heartbeat = existing.lastHeartbeatAt?.getTime() ?? 0;
    if (Date.now() - heartbeat < SEMANTIC_JOB_STALE_MS) return existing;
  }

  return prisma.semanticIndexJob.upsert({
    where: { worldId_version: { worldId, version } },
    create: { worldId, version, status: 'queued' },
    update: {
      status: 'queued',
      error: null,
      startedAt: null,
      lastHeartbeatAt: null,
      finishedAt: null
    }
  });
}

/**
 * Claim and execute one refresh. The claim is compare-and-set based so a
 * second request or a restarted process cannot run the same job concurrently.
 */
export async function runSemanticIndexJob(jobId: string) {
  const job = await prisma.semanticIndexJob.findUnique({ where: { id: jobId } });
  if (!job) return null;
  if (job.status === 'completed') return job;
  const now = new Date();
  const staleRunning =
    job.status === 'running' &&
    Date.now() - (job.lastHeartbeatAt?.getTime() ?? 0) >= SEMANTIC_JOB_STALE_MS;
  const claim = await prisma.semanticIndexJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: 'queued' },
        { status: 'failed' },
        ...(staleRunning ? [{ status: 'running' as const }] : [])
      ]
    },
    data: {
      status: 'running',
      attempts: { increment: 1 },
      startedAt: now,
      lastHeartbeatAt: now,
      finishedAt: null,
      error: null
    }
  });
  if (claim.count === 0) return prisma.semanticIndexJob.findUnique({ where: { id: jobId } });

  const claimed = await prisma.semanticIndexJob.findUniqueOrThrow({ where: { id: jobId } });
  try {
    const world = await prisma.world.findUnique({
      where: { id: claimed.worldId },
      select: { masterVersion: true }
    });
    if (!world || world.masterVersion !== claimed.version) {
      throw new Error('semantic index job superseded by a newer world version');
    }
    const result = await indexWorldSemantic(claimed.worldId, defaultEmbed, {
      version: claimed.version,
      onProgress: async () => {
        await prisma.semanticIndexJob.updateMany({
          where: { id: claimed.id, status: 'running' },
          data: { lastHeartbeatAt: new Date(), indexed: { increment: 1 } }
        });
      }
    });
    const finishedAt = new Date();
    await prisma.semanticIndexJob.updateMany({
      where: { id: claimed.id },
      data: {
        status: result.skipped ? 'failed' : 'completed',
        indexed: result.indexed,
        error: result.skipped ? (result.reason ?? 'semantic index skipped') : null,
        finishedAt,
        lastHeartbeatAt: finishedAt
      }
    });
    return prisma.semanticIndexJob.findUnique({ where: { id: claimed.id } });
  } catch (error) {
    const finishedAt = new Date();
    await prisma.semanticIndexJob.updateMany({
      where: { id: claimed.id },
      data: {
        status: 'failed',
        error: semanticJobErrorMessage(error),
        finishedAt,
        lastHeartbeatAt: finishedAt
      }
    });
    return prisma.semanticIndexJob.findUnique({ where: { id: claimed.id } });
  }
}

/** Mark a manual refresh as failed without retaining provider response bodies. */
export async function markSemanticIndexJobFailed(worldId: string, version: number, error: unknown) {
  await prisma.semanticIndexJob.updateMany({
    where: { worldId, version, status: { in: ['queued', 'running'] } },
    data: {
      status: 'failed',
      error: semanticJobErrorMessage(error),
      finishedAt: new Date(),
      lastHeartbeatAt: new Date()
    }
  });
}

export async function getSemanticIndexJob(worldId: string, version: number) {
  return prisma.semanticIndexJob.findUnique({ where: { worldId_version: { worldId, version } } });
}

export async function markSemanticIndexJobCompleted(
  worldId: string,
  version: number,
  indexed: number
) {
  await prisma.semanticIndexJob.updateMany({
    where: { worldId, version, status: { in: ['queued', 'running'] } },
    data: { status: 'completed', indexed, error: null, finishedAt: new Date() }
  });
}
