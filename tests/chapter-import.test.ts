import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  buildImportChapters,
  bytesToBase64,
  splitChapterContent,
  splitChapters
} from '@/lib/chapter-split';

vi.mock('@/lib/worldbuilding/manuscript', () => ({
  createManuscript: vi.fn(),
  addChapter: vi.fn()
}));
import { createManuscript, addChapter } from '@/lib/worldbuilding/manuscript';
import { POST as importText } from '@/app/api/worlds/[worldId]/manuscripts/import-text/route';
import { POST as appendBatch } from '@/app/api/worlds/[worldId]/manuscripts/[manuscriptId]/chapters/batch/route';

describe('front-end large manuscript import', () => {
  it('prioritizes bracketed chapter headings over decorative dividers, retaining text', () => {
    const text = '书名\n---\n第【1】段：第一回\n正文甲\n---\n第【2】段：第二回\n正文乙\n';
    const chapters = buildImportChapters(text);
    expect(chapters).toHaveLength(3);
    expect(chapters[1].title).toBe('第【1】段：第一回');
    expect(chapters[2].title).toBe('第【2】段：第二回');
    expect(chapters.map((chapter) => chapter.content).join('')).toBe(text);
  });

  it('normalizes BOM and line endings; long chapters retain titles and all characters', () => {
    const content = `\uFEFF第【1】段：第一回\r\n${'甲乙丙。\r\n'.repeat(10_000)}第【2】段：第二回\r\n结尾`;
    const chapters = buildImportChapters(content);
    expect(chapters[0].title).toBe('第【1】段：第一回（1）');
    expect(chapters[1].title).toBe('第【1】段：第一回（2）');
    expect(chapters.at(-1)?.title).toBe('第【2】段：第二回');
    expect(chapters.map((chapter) => chapter.content).join('')).toBe(
      content.slice(1).replace(/\r\n/g, '\n')
    );
    expect(Math.max(...chapters.map((chapter) => chapter.content.length))).toBeLessThanOrEqual(
      20_000
    );
  });

  it('retains manual-divider splitting when there are no actual headings', () => {
    expect(splitChapters('甲\n---\n乙')).toEqual(['甲', '乙']);
    expect(buildImportChapters('甲\n---\n乙').map((chapter) => chapter.content)).toEqual([
      '甲\n---\n',
      '乙'
    ]);
    expect(buildImportChapters('第一眼见到他，并非章节标题')[0].title).toBeUndefined();
    expect(() => buildImportChapters(' \n')).toThrow('没有可导入的内容');
  });

  it.each([
    `甲${' '.repeat(40_000)}`,
    `${'甲'.repeat(20_000)}\n---\n${'\n'.repeat(20_000)}`,
    `${'甲'.repeat(19_999)}🚀${'乙'.repeat(20_000)}`,
    `${'甲'.repeat(20_000)}${'甲'.repeat(20_000)}`,
    ' \n第【1】段\n重复\n第【1】段\n重复\n'
  ])('retains every character and bounds each piece for edge input %#', (text) => {
    const chapters = buildImportChapters(text);
    expect(chapters.map((chapter) => chapter.content).join('')).toBe(text);
    expect(
      chapters.every((chapter) => chapter.content.length > 0 && chapter.content.length <= 20_000)
    ).toBe(true);
    expect(chapters.every((chapter) => !/[\uD800-\uDBFF]$/.test(chapter.content))).toBe(true);
  });

  it('shares a lossless content slicer with JSON creation, without normalizing its input', () => {
    const text = `\uFEFF${'甲'.repeat(20_000)}\r\n${' '.repeat(20_001)}`;
    const pieces = splitChapterContent(text);
    expect(pieces.join('')).toBe(text);
    expect(pieces.every((piece) => piece.length <= 20_000)).toBe(true);
    expect(() => splitChapterContent('甲', 0)).toThrow('Invalid chapter limit');
  });

  it('handles multi-megabyte binary files without a whole-file spread', () => {
    const bytes = Uint8Array.from({ length: 2_899_799 }, (_, index) => index % 256);
    const encoded = bytesToBase64(bytes);
    expect(Buffer.from(encoded, 'base64').equals(Buffer.from(bytes))).toBe(true);
  });
});

describe('text import and batch append route contracts (mock storage)', () => {
  const create = vi.mocked(createManuscript);
  const append = vi.mocked(addChapter);
  beforeEach(() => {
    create.mockReset();
    append.mockReset();
  });

  it('plain-text import retains repeated pieces and matches the browser normalization', async () => {
    const text = `\uFEFF第【1】段\r\n${'甲'.repeat(40_000)}\r\n第【1】段\r\n${'甲'.repeat(40_000)}\r\n`;
    const request = new NextRequest('http://localhost/api/worlds/fixture/manuscripts/import-text', {
      method: 'POST',
      body: text,
      headers: { 'x-manuscript-title': encodeURIComponent('重复正文') }
    });
    const response = await importText(request, { params: Promise.resolve({ worldId: 'fixture' }) });
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledExactlyOnceWith('fixture', {
      title: '重复正文',
      chapters: buildImportChapters(text)
    });
    const chapters = create.mock.calls[0][1].chapters!;
    expect(chapters.map((chapter) => chapter.content).join('')).toBe(
      text.slice(1).replace(/\r\n/g, '\n')
    );
  });

  it('rejects an oversized later chapter before appending any item', async () => {
    const request = new NextRequest(
      'http://localhost/api/worlds/fixture/manuscripts/book/chapters/batch',
      {
        method: 'POST',
        body: JSON.stringify({ chapters: [{ content: '甲' }, { content: '乙'.repeat(20_001) }] })
      }
    );
    const response = await appendBatch(request, {
      params: Promise.resolve({ worldId: 'fixture', manuscriptId: 'book' })
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_request');
    expect(append).not.toHaveBeenCalled();
  });

  it('appends repeated content and whitespace pieces at the exact limit without deduplication', async () => {
    const chapters = [
      { content: '甲'.repeat(20_000) },
      { content: '甲'.repeat(20_000) },
      { content: ' '.repeat(20_000) }
    ];
    const request = new NextRequest(
      'http://localhost/api/worlds/fixture/manuscripts/book/chapters/batch',
      {
        method: 'POST',
        body: JSON.stringify({ chapters })
      }
    );
    const response = await appendBatch(request, {
      params: Promise.resolve({ worldId: 'fixture', manuscriptId: 'book' })
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ appended: 3 });
    expect(append.mock.calls.map((call) => call[2])).toEqual(chapters);
  });
});
