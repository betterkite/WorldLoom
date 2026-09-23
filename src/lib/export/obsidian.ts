import { prisma } from '@/lib/db/client';
import { createZip } from './zip';

/**
 * Obsidian vault export (A6-1): read-only snapshot of the master version as a
 * markdown vault — entity notes with frontmatter, timeline.md (chronological
 * chronicle per epoch with causal markers), relations.md, README.
 */

function frontmatter(record: Record<string, unknown>): string {
  const lines = Object.entries(record).map(([key, value]) =>
    Array.isArray(value) ? `${key}: [${value.join(', ')}]` : `${key}: ${value ?? ''}`
  );
  return `---\n${lines.join('\n')}\n---\n`;
}

function slug(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]+/g, '-').slice(0, 80);
}

export async function buildObsidianVault(worldId: string) {
  const world = await prisma.world.findUnique({ where: { id: worldId } });
  if (!world) throw new Error(`World not found: ${worldId}`);
  const v = world.masterVersion;

  const [entities, events, epochs, edges, relations] = await Promise.all([
    prisma.entity.findMany({ where: { worldId, version: v }, orderBy: { name: 'asc' } }),
    prisma.chronicleEvent.findMany({
      where: { worldId, version: v },
      orderBy: { sortOrder: 'asc' }
    }),
    prisma.epoch.findMany({ where: { worldId, version: v }, orderBy: { order: 'asc' } }),
    prisma.eventEdge.findMany({ where: { worldId, version: v } }),
    prisma.relationshipEvent.findMany({ where: { worldId, version: v } })
  ]);

  const entityByUid = new Map(entities.map((e) => [e.uid, e]));
  const epochByUid = new Map(epochs.map((e) => [e.uid, e]));
  const causeTitle = new Map(
    edges.map((edge) => {
      const cause = events.find((e) => e.uid === edge.causeUid);
      return [edge.effectUid, cause?.title ?? edge.causeUid];
    })
  );

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
            ...epochEvents.map((event) => {
              const cause = causeTitle.get(event.uid);
              const participants = event.participantUids
                .map((uid) => entityByUid.get(uid)?.name)
                .filter(Boolean)
                .map((name) => `[[${slug(name as string)}]]`)
                .join('、');
              return [
                `### ${event.epochYear ?? '?'} 年 · ${event.title}`,
                event.summary,
                participants ? `参与者：${participants}` : '',
                cause ? `因果：[[${slug(`事件 ${cause}`)}|${cause}]] → 本事件` : '',
                ''
              ]
                .filter(Boolean)
                .join('\n');
            }),
            ''
          ];
        }),
        ...(events.some((event) => !event.epochUid)
          ? ['## 未分期', ...events.filter((e) => !e.epochUid).map((e) => `### ${e.title}`), '']
          : [])
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
            ? (events.find((e) => e.uid === relation.eventUid)?.title ?? '')
            : '';
          return `- [[${slug(subject)}]] —${relation.relation}（${relation.polarity}）→ [[${slug(object)}]]${anchor ? ` @ ${anchor}` : ''}`;
        })
      ].join('\n')
    }
  ];

  for (const entity of entities) {
    files.push({
      path: `entities/${slug(entity.name)}.md`,
      content: [
        frontmatter({
          type: entity.kind,
          confidence: entity.confidence,
          tags: entity.tags,
          aliases: entity.aliases
        }),
        `# ${entity.name}`,
        entity.summary ? `\n> ${entity.summary}` : '',
        '',
        entity.content
      ].join('\n')
    });
  }

  for (const event of events) {
    const epoch = event.epochUid ? epochByUid.get(event.epochUid)?.name : null;
    files.push({
      path: `events/${slug(`事件 ${event.title}`)}.md`,
      content: [
        frontmatter({
          type: 'event',
          epoch: epoch ?? '',
          year: event.epochYear ?? '',
          confidence: event.confidence
        }),
        `# 事件 ${event.title}`,
        event.summary ? `\n> ${event.summary}` : '',
        '',
        event.content,
        causeTitle.has(event.uid)
          ? `\n起因：[[${slug(`事件 ${causeTitle.get(event.uid)}`)}|${causeTitle.get(event.uid)}]]`
          : ''
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
