import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  world: { findUnique: vi.fn() },
  entity: { findMany: vi.fn() },
  chronicleEvent: { findMany: vi.fn() },
  epoch: { findMany: vi.fn() },
  eventEdge: { findMany: vi.fn() },
  relationshipEvent: { findMany: vi.fn() }
}));
vi.mock('@/lib/db/client', () => ({ prisma: db }));

import { exportWorldZip } from '@/lib/export/obsidian';

function entity(uid: string, name: string) {
  return {
    uid,
    name,
    kind: 'character',
    confidence: 'EXTRACTED',
    tags: [],
    aliases: [],
    summary: `summary-${uid}`,
    content: `body-${uid}`,
    sourceRefs: ['source_a']
  };
}

function event(uid: string, title: string, year = 1) {
  return {
    uid,
    title,
    summary: `summary-${uid}`,
    content: `body-${uid}`,
    epochUid: 'epoch',
    epochYear: year,
    epochMonth: 1,
    epochDay: 2,
    fictionPrecision: 'day',
    sortOrder: 0,
    participantUids: ['entity_a', 'entity_b'],
    confidence: 'EXTRACTED',
    sourceRefs: ['source_a']
  };
}

// Read every stored ZIP entry, retaining duplicates (a path-keyed map would
// silently conceal the data-loss bug this test is intended to catch).
function entries(buffer: Buffer) {
  const files: { path: string; content: string }[] = [];
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    expect(buffer.readUInt16LE(offset + 8)).toBe(0);
    const nameBytes = buffer.readUInt16LE(offset + 26);
    const extraBytes = buffer.readUInt16LE(offset + 28);
    const size = buffer.readUInt32LE(offset + 18);
    const start = offset + 30 + nameBytes + extraBytes;
    files.push({
      path: buffer.toString('utf8', offset + 30, offset + 30 + nameBytes),
      content: buffer.toString('utf8', start, start + size)
    });
    offset = start + size;
  }
  expect(buffer.readUInt32LE(offset)).toBe(0x02014b50);
  return files;
}

function properties(content: string): Record<string, unknown> {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(content);
  expect(block).not.toBeNull();
  return Object.fromEntries(
    block![1].split('\n').map((line) => {
      const split = line.indexOf(':');
      return [line.slice(0, split), JSON.parse(line.slice(split + 1))];
    })
  );
}

function targets(content: string) {
  return [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((match) => `${match[1]}.md`);
}

beforeEach(() => {
  vi.resetAllMocks();
  db.world.findUnique.mockResolvedValue({
    id: 'world',
    name: '导出',
    masterVersion: 7,
    premise: '',
    style: '',
    calendarJson: null
  });
  db.entity.findMany.mockResolvedValue([entity('entity_a', '同名'), entity('entity_b', '同名')]);
  db.chronicleEvent.findMany.mockResolvedValue([
    event('event_a', '起因'),
    event('event_b', '起因'),
    event('effect', '结果', 2)
  ]);
  db.epoch.findMany.mockResolvedValue([{ uid: 'epoch', name: '初纪', order: 0, description: '' }]);
  db.eventEdge.findMany.mockResolvedValue([
    { causeUid: 'event_b', effectUid: 'effect' },
    { causeUid: 'event_a', effectUid: 'effect' }
  ]);
  db.relationshipEvent.findMany.mockResolvedValue([
    {
      subjectUid: 'entity_a',
      objectUid: 'entity_b',
      relation: '盟友',
      polarity: 'establish',
      eventUid: 'event_b'
    }
  ]);
});

describe('Obsidian ZIP preserves source identities (#17)', () => {
  it('retains every colliding, case-sensitive and Unicode name with bounded unique paths', async () => {
    const names = [
      'A/B',
      'A:B',
      '同名',
      '同名',
      'Case',
      'case',
      'e\u0301',
      'é',
      '界'.repeat(60),
      `${'界'.repeat(59)}别`,
      '..',
      'CON'
    ];
    const rows = names.map((name, i) => entity(`uid/${i}`, name));
    db.entity.findMany.mockResolvedValue(rows);
    const files = entries((await exportWorldZip('world')).buffer);
    const notes = files.filter((file) => file.path.startsWith('entities/'));
    expect(notes).toHaveLength(rows.length);
    expect(new Set(files.map((file) => file.path.normalize('NFC').toLowerCase())).size).toBe(
      files.length
    );
    for (const row of rows) {
      const note = notes.find((file) => properties(file.content).uid === row.uid)!;
      expect(note).toBeDefined();
      expect(note.content).toContain(row.content);
      expect(properties(note.content).name).toBe(row.name);
      expect(Buffer.byteLength(note.path.split('/').at(-1)!, 'utf8')).toBeLessThanOrEqual(255);
      expect(note.path.split('/')).not.toContain('..');
    }
    db.entity.findMany.mockResolvedValue(rows.toReversed());
    const again = entries((await exportWorldZip('world')).buffer).filter((file) =>
      file.path.startsWith('entities/')
    );
    expect(again.map((file) => file.path).toSorted()).toEqual(
      notes.map((file) => file.path).toSorted()
    );
  });

  it('resolves links by UID and preserves all causes even with duplicate event titles', async () => {
    const files = entries((await exportWorldZip('world')).buffer);
    const paths = new Set(files.map((file) => file.path));
    for (const file of files)
      for (const target of targets(file.content)) expect(paths.has(target)).toBe(true);
    const eventFiles = files.filter((file) => file.path.startsWith('events/'));
    const causePaths = ['event_a', 'event_b'].map(
      (uid) => eventFiles.find((file) => properties(file.content).uid === uid)!.path
    );
    const effect = eventFiles.find((file) => properties(file.content).uid === 'effect')!;
    expect(targets(effect.content)).toEqual(causePaths);
    const timeline = files.find((file) => file.path === 'timeline.md')!.content;
    const effectBlock = timeline.slice(timeline.indexOf(`|结果]]`));
    for (const path of causePaths) expect(targets(effectBlock)).toContain(path);
    const relationTargets = targets(files.find((file) => file.path === 'relations.md')!.content);
    expect(relationTargets).toContain(causePaths[1]);
    expect(new Set(relationTargets.filter((path) => path.startsWith('entities/'))).size).toBe(2);
    for (const table of [
      'entity',
      'chronicleEvent',
      'epoch',
      'eventEdge',
      'relationshipEvent'
    ] as const) {
      expect(db[table].findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { worldId: 'world', version: 7 } })
      );
    }
  });

  it('preserves scalar and array property values without YAML coercion or injected fields', async () => {
    const aliases = [
      'a: b',
      'a,b',
      '"quoted"',
      'true',
      'null',
      '01',
      'line\nnext',
      '[nested]',
      '中文'
    ];
    db.entity.findMany.mockResolvedValue([
      { ...entity('entity_a', '名|[称]'), aliases, tags: aliases }
    ]);
    db.chronicleEvent.findMany.mockResolvedValue([event('event_a', '同|[日]')]);
    db.eventEdge.findMany.mockResolvedValue([]);
    const files = entries((await exportWorldZip('world')).buffer);
    const note = files.find((file) => file.path.startsWith('entities/'))!;
    expect(properties(note.content)).toMatchObject({
      aliases,
      tags: aliases,
      name: '名|[称]',
      sourceRefs: ['source_a']
    });
    const eventNote = files.find((file) => file.path.startsWith('events/'))!;
    expect(properties(eventNote.content)).toMatchObject({
      year: 1,
      month: 1,
      day: 2,
      precision: 'day',
      title: '同|[日]'
    });
    const timeline = files.find((file) => file.path === 'timeline.md')!.content;
    expect(targets(timeline)).toContain(note.path);
    expect(targets(timeline)).toContain(eventNote.path);
    expect(timeline).toContain('&#124;');
  });

  it('keeps missing reference identities explicit instead of emitting broken note links', async () => {
    db.chronicleEvent.findMany.mockResolvedValue([
      { ...event('effect', '未分期'), epochUid: null, participantUids: ['missing_entity'] }
    ]);
    db.eventEdge.findMany.mockResolvedValue([{ causeUid: 'missing_cause', effectUid: 'effect' }]);
    db.relationshipEvent.findMany.mockResolvedValue([
      {
        subjectUid: 'missing_entity',
        objectUid: 'entity_a',
        relation: '同行',
        polarity: 'establish',
        eventUid: 'missing_anchor'
      }
    ]);
    const files = entries((await exportWorldZip('world')).buffer);
    const paths = new Set(files.map((file) => file.path));
    for (const file of files)
      for (const target of targets(file.content)) expect(paths.has(target)).toBe(true);
    const timeline = files.find((file) => file.path === 'timeline.md')!.content;
    expect(timeline).toContain('缺失引用（missing_cause）');
    expect(timeline).toContain('缺失引用（missing_entity）');
    expect(timeline).toContain('summary-effect');
    expect(files.find((file) => file.path === 'relations.md')!.content).toContain(
      '缺失引用（missing_anchor）'
    );
  });

  it('rejects duplicate source identity rather than emitting duplicate ZIP entries', async () => {
    db.entity.findMany.mockResolvedValue([entity('duplicate', '甲'), entity('duplicate', '乙')]);
    await expect(exportWorldZip('world')).rejects.toThrow('conflicting note paths');
  });

  it('retargets existing body wiki links and aliases without guessing ambiguous titles or rewriting code', async () => {
    const code = '`[[乙]]`\n```md\n[[乙|code]]\n```\n~~~md\n[[乙]]\n~~~\n    [[乙]]\n\t[[乙]]';
    db.entity.findMany.mockResolvedValue([
      {
        ...entity('entity_a', '甲'),
        content: `[[乙|旧友]] 与 [[乙#经历]]\n[[同名|不确定]]\n${code}\n[[外部笔记]]`
      },
      { ...entity('entity_b', '乙'), aliases: ['别名'] },
      entity('dup_1', '同名'),
      entity('dup_2', '同名')
    ]);
    db.chronicleEvent.findMany.mockResolvedValue([
      { ...event('event_a', '会面'), content: '参考 [[别名]] 与 [[甲]]' }
    ]);
    db.eventEdge.findMany.mockResolvedValue([]);
    const files = entries((await exportWorldZip('world')).buffer);
    const notes = files.filter((file) => file.path.startsWith('entities/'));
    const a = notes.find((file) => properties(file.content).uid === 'entity_a')!;
    const b = notes.find((file) => properties(file.content).uid === 'entity_b')!;
    expect(a.content).toContain(`[[${b.path.slice(0, -3)}|旧友]]`);
    expect(a.content).toContain(`[[${b.path.slice(0, -3)}#经历|乙#经历]]`);
    expect(a.content).toContain('不确定（同名引用：同名，未自动指定条目）');
    expect(a.content).toContain(code);
    expect(a.content).toContain('[[外部笔记]]');
    const note = files.find((file) => file.path.startsWith('events/'))!;
    expect(targets(note.content)).toEqual([b.path, a.path]);
  });

  it('keeps unknown date components null in event properties', async () => {
    db.chronicleEvent.findMany.mockResolvedValue([
      {
        ...event('unknown', '日期待考'),
        epochYear: null,
        epochMonth: null,
        epochDay: null,
        fictionPrecision: 'year'
      }
    ]);
    db.eventEdge.findMany.mockResolvedValue([]);
    const files = entries((await exportWorldZip('world')).buffer);
    const note = files.find((file) => file.path.startsWith('events/'))!;
    expect(properties(note.content)).toMatchObject({
      year: null,
      month: null,
      day: null,
      precision: 'year'
    });
  });
});
