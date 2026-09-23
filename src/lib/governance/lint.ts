import { prisma } from '@/lib/db/client';
import { GovernanceError, requireWorld } from './changes';
import { daysInMonth, parseCalendar } from '@/lib/worldbuilding/calendar';

/**
 * Chronicle lint engine (Phase 3).
 *
 * Rules run against the master version's content rows and persist as
 * LintFinding rows. Re-running is idempotent: findings are deduped by
 * fingerprint (rule:target:related); a finding the user ignored stays
 * ignored; fingerprints that no longer fire are marked fixed.
 *
 * Heuristic honesty: `dead_participant` relies on a death-word convention in
 * event title/summary (死/卒/陨落/died/…) and reports warnings only — it is
 * advisory, never blocking.
 */

interface Finding {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  targetUid: string | null;
  relatedUid: string | null;
  message: string;
  fingerprint: string;
}

const DEATH_PATTERN = /(死|卒|陨落|阵亡|去世|亡故|战死|毙命|died|death|slain|killed)/i;

export const LINT_QUALITY_BOUNDARY = {
  mode: 'rules' as const,
  semanticReview: 'not_configured' as const,
  evidence: 'master_version' as const,
  automatedWriteback: false,
  heuristicRules: ['dead_participant']
};

export async function runLint(worldId: string) {
  const world = await requireWorld(worldId);
  const v = world.masterVersion;

  const [epochs, entities, events, edges, relations, previous] = await Promise.all([
    prisma.epoch.findMany({ where: { worldId, version: v }, select: { uid: true, name: true } }),
    prisma.entity.findMany({ where: { worldId, version: v }, select: { uid: true, name: true } }),
    prisma.chronicleEvent.findMany({ where: { worldId, version: v } }),
    prisma.eventEdge.findMany({ where: { worldId, version: v } }),
    prisma.relationshipEvent.findMany({ where: { worldId, version: v } }),
    prisma.lintFinding.findMany({ where: { worldId, version: v } })
  ]);

  const eventByUid = new Map(events.map((e) => [e.uid, e]));
  const entityUids = new Set(entities.map((e) => e.uid));
  const epochUids = new Set(epochs.map((e) => e.uid));
  const entityName = new Map(entities.map((e) => [e.uid, e.name]));
  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);

  // ---- R1 causal_inversion: cause must not sort after its effect ----
  for (const edge of edges) {
    const cause = eventByUid.get(edge.causeUid);
    const effect = eventByUid.get(edge.effectUid);
    if (!cause || !effect) continue; // dangling handled by R2
    if (cause.sortOrder > effect.sortOrder) {
      push({
        rule: 'causal_inversion',
        severity: 'error',
        targetUid: effect.uid,
        relatedUid: cause.uid,
        message: `因果倒置：「${cause.title}」(sort ${cause.sortOrder}) 晚于其结果「${effect.title}」(sort ${effect.sortOrder})`,
        fingerprint: `causal_inversion:${effect.uid}:${cause.uid}`
      });
    }
  }

  // ---- R2 dangling_reference ----
  for (const event of events) {
    if (event.epochUid && !epochUids.has(event.epochUid)) {
      push({
        rule: 'dangling_reference',
        severity: 'error',
        targetUid: event.uid,
        relatedUid: event.epochUid,
        message: `事件「${event.title}」引用了不存在的纪元 ${event.epochUid}`,
        fingerprint: `dangling_reference:${event.uid}:${event.epochUid}`
      });
    }
    if (event.locationUid && !entityUids.has(event.locationUid)) {
      push({
        rule: 'dangling_reference',
        severity: 'error',
        targetUid: event.uid,
        relatedUid: event.locationUid,
        message: `事件「${event.title}」引用了不存在的地点 ${event.locationUid}`,
        fingerprint: `dangling_reference:${event.uid}:${event.locationUid}`
      });
    }
    for (const participant of event.participantUids) {
      if (!entityUids.has(participant)) {
        push({
          rule: 'dangling_reference',
          severity: 'error',
          targetUid: event.uid,
          relatedUid: participant,
          message: `事件「${event.title}」的参与者 ${participant} 不存在`,
          fingerprint: `dangling_reference:${event.uid}:${participant}`
        });
      }
    }
  }
  for (const edge of edges) {
    for (const [role, uid] of [
      ['cause', edge.causeUid],
      ['effect', edge.effectUid]
    ] as const) {
      if (!eventByUid.has(uid)) {
        push({
          rule: 'dangling_reference',
          severity: 'error',
          targetUid: role === 'cause' ? edge.effectUid : edge.causeUid,
          relatedUid: uid,
          message: `因果边引用了不存在的事件 ${uid}`,
          fingerprint: `dangling_reference:${role}:${uid}`
        });
      }
    }
  }
  for (const relation of relations) {
    if (!entityUids.has(relation.subjectUid) || !entityUids.has(relation.objectUid)) {
      push({
        rule: 'dangling_reference',
        severity: 'error',
        targetUid: relation.uid,
        relatedUid: relation.subjectUid,
        message: '关系事件引用了不存在的条目',
        fingerprint: `dangling_reference:${relation.uid}:${relation.subjectUid}`
      });
    }
    if (relation.eventUid && !eventByUid.has(relation.eventUid)) {
      push({
        rule: 'dangling_reference',
        severity: 'error',
        targetUid: relation.uid,
        relatedUid: relation.eventUid,
        message: '关系事件锚定的事件不存在',
        fingerprint: `dangling_reference:${relation.uid}:${relation.eventUid}`
      });
    }
  }

  // ---- R3 orphan_event ----
  for (const event of events) {
    if (event.participantUids.length === 0 && !event.locationUid) {
      push({
        rule: 'orphan_event',
        severity: 'warning',
        targetUid: event.uid,
        relatedUid: null,
        message: `事件「${event.title}」没有参与者也没有地点`,
        fingerprint: `orphan_event:${event.uid}`
      });
    }
  }

  // ---- R4 epoch_gap ----
  const eventCountByEpoch = new Map<string, number>();
  for (const event of events) {
    if (event.epochUid) {
      eventCountByEpoch.set(event.epochUid, (eventCountByEpoch.get(event.epochUid) ?? 0) + 1);
    }
  }
  for (const epoch of epochs) {
    if ((eventCountByEpoch.get(epoch.uid) ?? 0) === 0) {
      push({
        rule: 'epoch_gap',
        severity: 'warning',
        targetUid: epoch.uid,
        relatedUid: null,
        message: `纪元「${epoch.name}」下没有任何事件`,
        fingerprint: `epoch_gap:${epoch.uid}`
      });
    }
  }

  // ---- R5 duplicate_name (normalized) ----
  const byName = new Map<string, string[]>();
  for (const entity of entities) {
    const key = entity.name.replace(/\s+/g, '').toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), entity.uid]);
  }
  for (const [, uids] of byName) {
    if (uids.length > 1) {
      const names = uids.map((uid) => entityName.get(uid) ?? uid).join('、');
      for (const uid of uids.slice(1)) {
        push({
          rule: 'duplicate_name',
          severity: 'warning',
          targetUid: uid,
          relatedUid: uids[0],
          message: `条目重名：${names}（保留首个，其余标记）`,
          fingerprint: `duplicate_name:${uid}:${uids[0]}`
        });
      }
    }
  }

  // ---- R6 self_relation ----
  for (const relation of relations) {
    if (relation.subjectUid === relation.objectUid) {
      push({
        rule: 'self_relation',
        severity: 'warning',
        targetUid: relation.uid,
        relatedUid: null,
        message: '关系事件的主体与客体是同一条目',
        fingerprint: `self_relation:${relation.uid}`
      });
    }
  }

  // ---- R7b calendar_range（自定义历法下的月/日范围） ----
  const calendar = parseCalendar(world.calendarJson);
  if (calendar) {
    for (const event of events) {
      if (event.epochMonth !== null) {
        const days = daysInMonth(calendar, event.epochMonth);
        if (days === null) {
          push({
            rule: 'calendar_range',
            severity: 'warning',
            targetUid: event.uid,
            relatedUid: null,
            message: `事件「${event.title}」的月份 ${event.epochMonth} 超出历法范围（共 ${calendar.months.length} 月）`,
            fingerprint: `calendar_range:${event.uid}:m${event.epochMonth}`
          });
        } else if (event.epochDay !== null && event.epochDay > days) {
          push({
            rule: 'calendar_range',
            severity: 'warning',
            targetUid: event.uid,
            relatedUid: null,
            message: `事件「${event.title}」的日期 ${event.epochDay} 日超出「${calendar.months[event.epochMonth - 1].name}」的 ${days} 天`,
            fingerprint: `calendar_range:${event.uid}:d${event.epochDay}`
          });
        }
      }
    }
  }

  // ---- R7 dead_participant (heuristic) ----
  const deceasedAt = new Map<string, number>();
  for (const event of events) {
    if (!DEATH_PATTERN.test(`${event.title}${event.summary}`)) continue;
    for (const participant of event.participantUids) {
      const current = deceasedAt.get(participant);
      deceasedAt.set(participant, Math.min(current ?? Number.POSITIVE_INFINITY, event.sortOrder));
    }
  }
  for (const event of events) {
    for (const participant of event.participantUids) {
      const deathSort = deceasedAt.get(participant);
      if (deathSort !== undefined && event.sortOrder > deathSort) {
        push({
          rule: 'dead_participant',
          severity: 'warning',
          targetUid: event.uid,
          relatedUid: participant,
          message: `「${entityName.get(participant) ?? participant}」疑似已故，却出现在其后的事件「${event.title}」中（启发式）`,
          fingerprint: `dead_participant:${event.uid}:${participant}`
        });
      }
    }
  }

  // ---- persist with ignore-preservation + auto-fixed ----
  const previousByFingerprint = new Map(previous.map((f) => [f.fingerprint, f]));
  await prisma.$transaction(async (tx) => {
    const seen = new Set<string>();
    for (const finding of findings) {
      seen.add(finding.fingerprint);
      const existing = previousByFingerprint.get(finding.fingerprint);
      if (existing) {
        await tx.lintFinding.update({
          where: { id: existing.id },
          data: { message: finding.message, severity: finding.severity }
        });
      } else {
        await tx.lintFinding.create({
          data: {
            worldId,
            version: v,
            rule: finding.rule,
            severity: finding.severity,
            targetUid: finding.targetUid,
            relatedUid: finding.relatedUid,
            message: finding.message,
            fingerprint: finding.fingerprint
          }
        });
      }
    }
    const vanished = previous.filter((f) => !seen.has(f.fingerprint) && f.status !== 'fixed');
    for (const f of vanished) {
      await tx.lintFinding.update({ where: { id: f.id }, data: { status: 'fixed' } });
    }
    // Findings snapshotted at older versions are historical: once the master
    // moves on they are superseded by the current run (which re-fires anything
    // still broken as a fresh row at the new version).
    await tx.lintFinding.updateMany({
      where: { worldId, version: { lt: v }, status: { in: ['open', 'ignored'] } },
      data: { status: 'fixed' }
    });
  });

  const stored = await prisma.lintFinding.findMany({
    where: { worldId, version: v },
    orderBy: [{ severity: 'asc' }, { rule: 'asc' }]
  });
  const counts = {
    error: stored.filter((f) => f.severity === 'error' && f.status === 'open').length,
    warning: stored.filter((f) => f.severity === 'warning' && f.status === 'open').length,
    fixed: stored.filter((f) => f.status === 'fixed').length
  };
  return { version: v, findings: stored, counts, qualityBoundary: LINT_QUALITY_BOUNDARY };
}

export async function listLintFindings(
  worldId: string,
  status: 'open' | 'ignored' | 'fixed' | null = null
) {
  const world = await requireWorld(worldId);
  return prisma.lintFinding.findMany({
    where: { worldId, version: world.masterVersion, ...(status ? { status } : {}) },
    orderBy: [{ severity: 'asc' }, { rule: 'asc' }]
  });
}

export async function updateLintFinding(
  worldId: string,
  findingId: string,
  status: 'open' | 'ignored' | 'fixed'
) {
  const finding = await prisma.lintFinding.findUnique({ where: { id: findingId } });
  if (!finding || finding.worldId !== worldId) {
    throw new GovernanceError('finding_not_found', 'Lint finding not found');
  }
  return prisma.lintFinding.update({ where: { id: findingId }, data: { status } });
}
