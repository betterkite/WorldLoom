import { createHash } from 'node:crypto';
import { createChronology } from '@/lib/worldbuilding/chronology';
import { prisma } from '@/lib/db/client';
import { createZip } from './zip';
import { formatFictionDate, parseCalendar } from '@/lib/worldbuilding/calendar';

/**
 * Obsidian vault export (A6-1): read-only snapshot of the master version as a
 * markdown vault — entity notes with frontmatter, timeline.md (chronological
 * chronicle per epoch with causal markers), relations.md, README.
 */

function frontmatter(record: Record<string, unknown>): string {
  // JSON values are also valid YAML values. Quoting preserves aliases/tags such
  // as "a: b", "true", commas and newlines instead of changing their types.
  const lines = Object.entries(record).map(
    ([key, value]) => `${key}: ${JSON.stringify(value ?? null)}`
  );
  return `---\n${lines.join('\n')}\n---\n`;
}

function slug(name: string): string {
  const cleaned = name.normalize('NFC').replace(/[\\/:*?"<>|#^[\]\p{Cc}]+/gu, '-');
  let result = '';
  for (const character of cleaned) {
    if (Buffer.byteLength(result + character, 'utf8') > 80) break;
    result += character;
  }
  return result.trim().replace(/[. ]+$/, '') || 'note';
}

function notePaths(rows: { uid: string; label: string }[], directory: string) {
  const paths = new Map<string, string>();
  const used = new Set<string>();
  for (const row of rows) {
    const identity = createHash('sha256').update(row.uid, 'utf8').digest('hex');
    const path = `${directory}/${slug(row.label)}--${identity}.md`;
    const portableKey = path.normalize('NFC').toLowerCase();
    if (paths.has(row.uid) || used.has(portableKey)) {
      throw new Error('Obsidian export produced conflicting note paths');
    }
    used.add(portableKey);
    paths.set(row.uid, path);
  }
  return paths;
}

function linkLabel(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;')
    .replace(/\|/g, '&#124;')
    .replace(/[\r\n]/g, ' ');
}

function noteLink(path: string | undefined, label: string) {
  return path ? `[[${path.slice(0, -3)}|${linkLabel(label)}]]` : `缺失引用（${linkLabel(label)}）`;
}

function addLinkTarget(targets: Map<string, Set<string>>, label: string, path: string) {
  const key = label.normalize('NFC').replace(/\.md$/, '');
  const matches = targets.get(key) ?? new Set<string>();
  matches.add(path);
  targets.set(key, matches);
}

function rewriteWikiLinks(text: string, targets: Map<string, Set<string>>) {
  // Leave code spans/fences and external-vault references intact. Only resolve
  // known unambiguous notes; a repeated title must never choose an arbitrary UID.
  return text.replace(
    /^(?: {4}|\t)[^\r\n]*|(`+)[\s\S]*?\1|(?:^|\n) {0,3}~{3,}[^\n]*\n[\s\S]*?\n {0,3}~{3,}[^\S\n]*(?=\n|$)|(?<!\\)\[\[([^\r\n[\]]+)\]\]/gm,
    (original, _code: string | undefined, body: string | undefined) => {
      if (body === undefined) return original;
      const separator = body.indexOf('|');
      const destination = separator < 0 ? body : body.slice(0, separator);
      const label = separator < 0 ? destination : body.slice(separator + 1);
      const section = destination.indexOf('#');
      const target = section < 0 ? destination : destination.slice(0, section);
      const fragment = section < 0 ? '' : destination.slice(section);
      const matches = targets.get(target.normalize('NFC').replace(/\.md$/, ''));
      if (!matches) return original;
      if (matches.size !== 1)
        return `${linkLabel(label)}（同名引用：${linkLabel(target)}，未自动指定条目）`;
      const path = matches.values().next().value!;
      return `[[${path.slice(0, -3)}${fragment}|${linkLabel(label)}]]`;
    }
  );
}

export async function buildObsidianVault(worldId: string) {
  const world = await prisma.world.findUnique({ where: { id: worldId } });
  if (!world) throw new Error(`World not found: ${worldId}`);
  const v = world.masterVersion;

  const [entities, eventRows, epochs, edges, relations] = await Promise.all([
    prisma.entity.findMany({ where: { worldId, version: v }, orderBy: { name: 'asc' } }),
    prisma.chronicleEvent.findMany({
      where: { worldId, version: v },
      orderBy: { sortOrder: 'asc' }
    }),
    prisma.epoch.findMany({ where: { worldId, version: v }, orderBy: { order: 'asc' } }),
    prisma.eventEdge.findMany({ where: { worldId, version: v } }),
    prisma.relationshipEvent.findMany({ where: { worldId, version: v } })
  ]);

  const events = createChronology(eventRows, epochs).events;
  const entityByUid = new Map(entities.map((e) => [e.uid, e]));
  const eventByUid = new Map(events.map((event) => [event.uid, event]));
  const epochByUid = new Map(epochs.map((e) => [e.uid, e]));
  const entityPaths = notePaths(
    entities.map((entity) => ({ uid: entity.uid, label: entity.name })),
    'entities'
  );
  const eventPaths = notePaths(
    events.map((event) => ({ uid: event.uid, label: `事件 ${event.title}` })),
    'events'
  );
  const bodyTargets = new Map<string, Set<string>>();
  for (const entity of entities) {
    const path = entityPaths.get(entity.uid)!;
    for (const label of [
      entity.name,
      ...entity.aliases,
      slug(entity.name),
      `entities/${slug(entity.name)}`,
      path
    ]) {
      addLinkTarget(bodyTargets, label, path);
    }
  }
  for (const event of events) {
    const path = eventPaths.get(event.uid)!;
    for (const label of [
      event.title,
      `事件 ${event.title}`,
      slug(`事件 ${event.title}`),
      `events/${slug(`事件 ${event.title}`)}`,
      path
    ]) {
      addLinkTarget(bodyTargets, label, path);
    }
  }
  const eventPositions = new Map(events.map((event, index) => [event.uid, index]));
  const calendar = parseCalendar(world.calendarJson);
  const date = (event: (typeof events)[number]) =>
    formatFictionDate(
      {
        year: event.epochYear,
        month: event.fictionPrecision === 'year' ? null : event.epochMonth,
        day: event.fictionPrecision === 'day' ? event.epochDay : null
      },
      calendar
    );
  const unsequenced = events.filter((event) => !event.epochUid || !epochByUid.has(event.epochUid));
  const causeUids = new Map<string, Set<string>>();
  for (const edge of edges) {
    const causes = causeUids.get(edge.effectUid) ?? new Set<string>();
    causes.add(edge.causeUid);
    causeUids.set(edge.effectUid, causes);
  }
  const causesByEffect = new Map(
    [...causeUids].map(([effectUid, causes]) => [
      effectUid,
      [...causes]
        .toSorted(
          (a, b) =>
            (eventPositions.get(a) ?? Number.MAX_SAFE_INTEGER) -
              (eventPositions.get(b) ?? Number.MAX_SAFE_INTEGER) || (a < b ? -1 : a > b ? 1 : 0)
        )
        .map((uid) => noteLink(eventPaths.get(uid), eventByUid.get(uid)?.title ?? uid))
    ])
  );
  const timelineEntry = (event: (typeof events)[number]) => {
    const causes = causesByEffect.get(event.uid) ?? [];
    const participants = event.participantUids
      .map((uid) => noteLink(entityPaths.get(uid), entityByUid.get(uid)?.name ?? uid))
      .join('、');
    return [
      `### ${date(event)} · ${noteLink(eventPaths.get(event.uid), event.title)}`,
      rewriteWikiLinks(event.summary, bodyTargets),
      participants ? `参与者：${participants}` : '',
      causes.length ? `因果：${causes.join('、')} → 本事件` : '',
      ''
    ]
      .filter(Boolean)
      .join('\n');
  };

  const files: { path: string; content: string }[] = [
    {
      path: '.obsidian/app.json',
      content: JSON.stringify({ showLineNumber: true }, null, 2)
    },
    {
      path: 'README.md',
      content: [
        `# ${world.name}`,
        '',
        `> ${world.premise || '（无前提）'}`,
        world.style ? `\n基调：${world.style}` : '',
        '',
        `导出快照 · master v${v} · ${new Date().toISOString()}`,
        '',
        '- [[timeline]] — 编年史',
        '- [[relations]] — 人物关系'
      ]
        .filter(Boolean)
        .join('\n')
    },
    {
      path: 'timeline.md',
      content: [
        `# ${world.name} · 编年史`,
        '',
        ...epochs.flatMap((epoch) => {
          const epochEvents = events.filter((event) => event.epochUid === epoch.uid);
          if (epochEvents.length === 0) return [`## ${epoch.name}`, '（无事件）', ''];
          return [
            `## ${epoch.name}${epoch.description ? ` — ${epoch.description}` : ''}`,
            ...epochEvents.map(timelineEntry),
            ''
          ];
        }),
        ...(unsequenced.length ? ['## 未分期', ...unsequenced.map(timelineEntry), ''] : [])
      ].join('\n')
    },
    {
      path: 'relations.md',
      content: [
        `# ${world.name} · 关系`,
        '',
        ...relations.map((relation) => {
          const subject = entityByUid.get(relation.subjectUid)?.name ?? relation.subjectUid;
          const object = entityByUid.get(relation.objectUid)?.name ?? relation.objectUid;
          const anchor = relation.eventUid
            ? noteLink(
                eventPaths.get(relation.eventUid),
                eventByUid.get(relation.eventUid)?.title ?? relation.eventUid
              )
            : '';
          return `- ${noteLink(entityPaths.get(relation.subjectUid), subject)} —${relation.relation}（${relation.polarity}）→ ${noteLink(entityPaths.get(relation.objectUid), object)}${anchor ? ` @ ${anchor}` : ''}`;
        })
      ].join('\n')
    }
  ];

  for (const entity of entities) {
    files.push({
      path: entityPaths.get(entity.uid)!,
      content: [
        frontmatter({
          type: entity.kind,
          uid: entity.uid,
          name: entity.name,
          confidence: entity.confidence,
          tags: entity.tags,
          aliases: entity.aliases,
          sourceRefs: entity.sourceRefs
        }),
        `# ${entity.name}`,
        entity.summary ? `\n> ${rewriteWikiLinks(entity.summary, bodyTargets)}` : '',
        '',
        rewriteWikiLinks(entity.content, bodyTargets)
      ].join('\n')
    });
  }

  for (const event of events) {
    const epoch = event.epochUid ? epochByUid.get(event.epochUid)?.name : null;
    files.push({
      path: eventPaths.get(event.uid)!,
      content: [
        frontmatter({
          type: 'event',
          uid: event.uid,
          title: event.title,
          epoch: epoch ?? '',
          year: event.epochYear ?? null,
          month: event.epochMonth ?? null,
          day: event.epochDay ?? null,
          precision: event.fictionPrecision,
          confidence: event.confidence,
          sourceRefs: event.sourceRefs
        }),
        `# 事件 ${event.title}`,
        event.summary ? `\n> ${rewriteWikiLinks(event.summary, bodyTargets)}` : '',
        '',
        rewriteWikiLinks(event.content, bodyTargets),
        causesByEffect.has(event.uid) ? `\n起因：${causesByEffect.get(event.uid)!.join('、')}` : ''
      ].join('\n')
    });
  }

  return {
    files,
    filename: `${slug(world.name) || 'world'}-v${v}.zip`
  };
}

export async function exportWorldZip(
  worldId: string
): Promise<{ buffer: Buffer; filename: string; fileCount: number }> {
  const { files, filename } = await buildObsidianVault(worldId);
  return { buffer: createZip(files) as Buffer, filename, fileCount: files.length };
}
