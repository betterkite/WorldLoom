import { prisma } from '@/lib/db/client';
import { GovernanceError, requireWorld, submitChange } from '@/lib/governance/changes';
import { getRelationsAt } from './relations';
import type { ChatFn } from './genesis';
import { z } from 'zod';
import { withLlmUsageBudget } from '@/lib/llm/usage-budget';

/**
 * Continuation engine (Phase 5, ADR core-loop):
 *  世界状态摘要（光标前时间线 + 关系快照 + 作品梗概）→ LLM 生成候选后续
 *  （草稿态，rationale 必须引用既有设定）→ 审阅 → 采纳转为 Change 走审计链。
 * LLM 输出仍是名称引用；解析为 uid 发生在 accept 时（Node 是 staging 权威）。
 */

const candidateSchema = z.object({
  kind: z.enum(['event_suggestion', 'relation_shift', 'plot_arc']),
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(2000),
  epochName: z.string().max(60).nullable().default(null),
  year: z.number().int().min(-100_000).max(100_000).nullable().default(null),
  participants: z.array(z.string().max(60)).max(10).default([]),
  relation: z
    .object({
      subject: z.string().max(60),
      object: z.string().max(60),
      relation: z.string().min(1).max(40),
      polarity: z.enum(['establish', 'strengthen', 'weaken', 'terminate']).catch('establish')
    })
    .nullable()
    .default(null),
  rationale: z.string().min(1).max(2000)
});

const candidatesSchema = z.object({
  candidates: z.array(candidateSchema).min(1).max(5)
});

export type ContinuationCandidate = z.infer<typeof candidateSchema>;

function extractJson(text: string): unknown {
  let cleaned = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .trim();
  cleaned = cleaned
    .replace(/^```(?:json|JSON)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fallthrough */
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      /* fallthrough */
    }
  }
  throw new GovernanceError(
    'invalid_continuation',
    `推演返回非法 JSON：${cleaned.slice(0, 160) || '<empty>'}`
  );
}

/** 世界状态摘要：光标（或最新）事件、最近时间线、当前活跃关系、作品梗概。 */
async function buildWorldStateSummary(worldId: string, manuscriptId: string | null) {
  const world = await requireWorld(worldId);
  const manuscript = manuscriptId
    ? await prisma.manuscript.findFirst({ where: { id: manuscriptId, worldId } })
    : null;

  const anchor = manuscript?.cursorEventUid
    ? await prisma.chronicleEvent.findFirst({
        where: { worldId, uid: manuscript.cursorEventUid },
        orderBy: { version: 'desc' }
      })
    : null;

  const thresholdSort = anchor ? anchor.sortOrder : Number.POSITIVE_INFINITY;
  const [epochs, entities, events] = await Promise.all([
    prisma.epoch.findMany({
      where: { worldId, version: world.masterVersion },
      orderBy: { order: 'asc' }
    }),
    prisma.entity.findMany({
      where: { worldId, version: world.masterVersion },
      select: { uid: true, name: true, kind: true, summary: true }
    }),
    prisma.chronicleEvent.findMany({
      where: { worldId, version: world.masterVersion },
      orderBy: { sortOrder: 'asc' }
    })
  ]);
  const timeline = events.filter((event) => event.sortOrder <= thresholdSort).slice(-12);
  const epochName = (uid: string | null) => epochs.find((e) => e.uid === uid)?.name ?? '未分期';

  const openForeshadows = await prisma.foreshadow.findMany({
    where: { worldId, status: 'open' },
    orderBy: { createdAt: 'asc' },
    take: 10
  });

  const relationsAt = await getRelationsAt(worldId, {
    atEventUid: anchor ? anchor.uid : null,
    version: world.masterVersion
  });
  const activeRelations = relationsAt.edges.filter((edge) => edge.active).slice(0, 15);

  return {
    world,
    anchor,
    summaryText: [
      `【世界】${world.name}：${world.premise || '（无前提）'}`,
      manuscript ? `【作品】${manuscript.title}：${manuscript.synopsis || '（无梗概）'}` : '',
      `【当前时刻】${anchor ? `事件「${anchor.title}」（${epochName(anchor.epochUid)} ${anchor.epochYear ?? '?'} 年）` : '世界开端（尚无光标）'}`,
      '【最近时间线】',
      ...timeline.map(
        (event) =>
          `- ${epochName(event.epochUid)} ${event.epochYear ?? '?'} 年《${event.title}》${event.summary ? `：${event.summary}` : ''}`
      ),
      '【当前活跃关系】',
      ...(activeRelations.length
        ? activeRelations.map(
            (edge) => `- ${edge.subjectName} —${edge.relation}→ ${edge.objectName}`
          )
        : ['- （无）']),
      ...(openForeshadows.length
        ? [
            '【未回收伏笔（推演时必须考虑，候选应推进或回收它们）】',
            ...openForeshadows.map((f) => `- ${f.title}${f.detail ? `：${f.detail}` : ''}`)
          ]
        : []),
      '【已知条目】',
      entities
        .slice(0, 40)
        .map((entity) => `${entity.name}(${entity.kind})`)
        .join('、')
    ]
      .filter(Boolean)
      .join('\n'),
    epochNames: epochs.map((e) => e.name)
  };
}

/** 生成候选后续（草稿态，≤5 条，不触碰正史）。 */
export async function generateContinuations(
  worldId: string,
  chat: ChatFn,
  input: { manuscriptId?: string | null; instruction?: string } = {}
) {
  const { summaryText, epochNames } = await buildWorldStateSummary(
    worldId,
    input.manuscriptId ?? null
  );
  // 创世/推演技能注入（target: genesis|both）
  const skills = await prisma.skill.findMany({
    where: { enabled: true, target: { in: ['genesis', 'both'] } },
    orderBy: { createdAt: 'asc' }
  });
  const skillText = skills.length
    ? `【已启用技能约束】\n${skills.map((skill) => `- ${skill.name}: ${skill.instructions}`).join('\n')}`
    : '';

  const result = await withLlmUsageBudget(
    chat,
    'continuation generation'
  )({
    temperature: 0.8,
    maxTokens: 4000,
    messages: [
      {
        role: 'system',
        content: `你是世界观推演器。基于当前世界状态提议接下来可能发生的发展。规则：候选必须与已有设定严格衔接；rationale 必须明确引用既有事件/条目名称作为依据；输出严格 JSON，无多余文本。${skillText ? `\n${skillText}` : ''}`
      },
      {
        role: 'user',
        content: [
          summaryText,
          input.instruction ? `【创作者指令】${input.instruction}` : '',
          `可用纪元：${epochNames.join('、') || '（无）'}`,
          '',
          '任务：提出 3 个候选后续。输出 JSON：',
          '{"candidates":[{"kind":"event_suggestion|relation_shift|plot_arc","title","summary","epochName":纪元名或null,"year":数字或null,"participants":[条目名],"relation":{"subject","object","relation","polarity"}或null,"rationale":"引用了哪些既有事件/条目、为何合理"}]}'
        ]
          .filter(Boolean)
          .join('\n')
      }
    ]
  });

  const parsed = candidatesSchema.parse(extractJson(result.content));
  const created = [];
  for (const candidate of parsed.candidates) {
    created.push(
      await prisma.continuation.create({
        data: {
          worldId,
          manuscriptId: input.manuscriptId ?? null,
          kind: candidate.kind,
          payload: candidate as object,
          rationale: candidate.rationale,
          basisEventUid: input.manuscriptId
            ? ((await prisma.manuscript.findUnique({ where: { id: input.manuscriptId } }))
                ?.cursorEventUid ?? null)
            : null
        }
      })
    );
  }
  return { candidates: created };
}

export async function listContinuations(
  worldId: string,
  status: 'pending' | 'accepted' | 'dismissed' | null = 'pending'
) {
  await requireWorld(worldId);
  return prisma.continuation.findMany({
    where: { worldId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' }
  });
}

/** 采纳：把候选内容解析为真实 uid 并提交为 Change（走审计链）。 */
export async function acceptContinuation(worldId: string, continuationId: string) {
  const continuation = await prisma.continuation.findUnique({ where: { id: continuationId } });
  if (!continuation || continuation.worldId !== worldId) {
    throw new GovernanceError('continuation_not_found', 'Continuation not found');
  }
  if (continuation.status !== 'pending') {
    throw new GovernanceError(
      'continuation_not_pending',
      'Only pending continuations can be accepted'
    );
  }
  const world = await requireWorld(worldId);
  const candidate = continuation.payload as ContinuationCandidate;

  const resolveEntity = async (name: string): Promise<string | null> => {
    const row = await prisma.entity.findFirst({
      where: { worldId, version: world.masterVersion, name },
      select: { uid: true }
    });
    return row?.uid ?? null;
  };
  const resolveEpoch = async (name: string): Promise<string | null> => {
    const row = await prisma.epoch.findFirst({
      where: { worldId, version: world.masterVersion, name },
      select: { uid: true }
    });
    return row?.uid ?? null;
  };
  const resolveEventByTitle = async (title: string): Promise<string | null> => {
    const row = await prisma.chronicleEvent.findFirst({
      where: { worldId, version: world.masterVersion, title },
      select: { uid: true }
    });
    return row?.uid ?? null;
  };

  const defects: string[] = [];
  let acceptedChangeUid: string | null = null;

  if (candidate.kind === 'event_suggestion') {
    if (!candidate.epochName) throw new GovernanceError('invalid_continuation', '事件候选缺少纪元');
    const epochUid = await resolveEpoch(candidate.epochName);
    if (!epochUid) {
      defects.push(`未知纪元：${candidate.epochName}`);
    } else {
      const participants = (
        await Promise.all(
          candidate.participants.map(async (name) => ({ name, uid: await resolveEntity(name) }))
        )
      ).filter((p): p is { name: string; uid: string } => Boolean(p.uid));
      for (const participant of candidate.participants) {
        if (!participants.some((p) => p.name === participant))
          defects.push(`未知参与者：${participant}`);
      }
      const { change } = await submitChange(worldId, {
        kind: 'event_upsert',
        payload: {
          title: candidate.title,
          summary: candidate.summary,
          content: `（推演采纳）${candidate.rationale}`,
          epochUid,
          epochYear: candidate.year ?? 0,
          fictionPrecision: 'year',
          locationUid: null,
          participantUids: participants.map((p) => p.uid),
          confidence: 'UNVERIFIED',
          causeUids: continuation.basisEventUid ? [continuation.basisEventUid] : [],
          effectUids: []
        },
        author: 'continuation'
      });
      acceptedChangeUid = change.id;
    }
  } else if (candidate.kind === 'relation_shift' && candidate.relation) {
    const subjectUid = await resolveEntity(candidate.relation.subject);
    const objectUid = await resolveEntity(candidate.relation.object);
    if (!subjectUid) defects.push(`未知主体：${candidate.relation.subject}`);
    if (!objectUid) defects.push(`未知客体：${candidate.relation.object}`);
    if (subjectUid && objectUid) {
      const eventUid = candidate.title ? await resolveEventByTitle(candidate.title) : null;
      const { change } = await submitChange(worldId, {
        kind: 'relation_upsert',
        payload: {
          subjectUid,
          objectUid,
          relation: candidate.relation.relation,
          polarity: candidate.relation.polarity,
          note: `（推演采纳）${candidate.rationale}`.slice(0, 500),
          eventUid
        },
        author: 'continuation'
      });
      acceptedChangeUid = change.id;
    }
  } else {
    // plot_arc：沉淀为 concept 条目草稿（叙事线备忘）
    const { change } = await submitChange(worldId, {
      kind: 'entity_upsert',
      payload: {
        kind: 'concept',
        name: `叙事线：${candidate.title}`.slice(0, 60),
        aliases: [],
        summary: candidate.summary.slice(0, 200),
        content: `**推演叙事线**\n\n${candidate.summary}\n\n依据：${candidate.rationale}`,
        confidence: 'UNVERIFIED',
        tags: ['plot-arc'],
        sourceRefs: []
      },
      author: 'continuation'
    });
    acceptedChangeUid = change.id;
  }

  if (defects.length > 0 && !acceptedChangeUid) {
    throw new GovernanceError(
      'continuation_unresolvable',
      `候选无法落地：${defects.join('；')}`,
      defects
    );
  }

  await prisma.continuation.update({
    where: { id: continuationId },
    data: { status: 'accepted', acceptedChangeUid }
  });
  return { accepted: true, acceptedChangeUid, defects };
}

export async function dismissContinuation(worldId: string, continuationId: string) {
  const continuation = await prisma.continuation.findUnique({ where: { id: continuationId } });
  if (!continuation || continuation.worldId !== worldId) {
    throw new GovernanceError('continuation_not_found', 'Continuation not found');
  }
  if (continuation.status !== 'pending') {
    throw new GovernanceError(
      'continuation_not_pending',
      'Only pending continuations can be dismissed'
    );
  }
  await prisma.continuation.update({
    where: { id: continuationId },
    data: { status: 'dismissed' }
  });
  return { dismissed: true };
}
