/**
 * 章节标题切分（C-2/ISS 系列修复）：
 * 识别 第X章 / 第X回 / 第X节 / 第【N】段 / 第（N）话 等变体（含全角括号与空格）。
 * 用 RegExp 构造器以避免 .tsx 行内正则的转义层级问题。
 */
const PATTERN_SOURCE =
  '(?=^[ \\t]*第\\s*[【\\[（(]?\\s*[一二三四五六七八九十百千零两0-9]+\\s*[】\\]）)]?\\s*[段回章节话])';

export const chapterSplitPattern = new RegExp(PATTERN_SOURCE, 'gm');
export const IMPORT_CHAPTER_CONTENT_LIMIT = 20_000;

export function splitChapters(text: string): string[] {
  // A book may contain decorative Markdown dividers as well as real chapter
  // headings. Prefer headings; a divider must not collapse all chapters.
  if (new RegExp(PATTERN_SOURCE, 'm').test(text)) return text.split(chapterSplitPattern);
  if (/\n\s*---+\s*\n/.test(text)) {
    return text.split(/\n\s*---+\s*\n/);
  }
  return text.split(chapterSplitPattern);
}

/** Lossless slices; unlike import normalization this also preserves CR/BOM. */
export function splitChapterContent(content: string, limit = IMPORT_CHAPTER_CONTENT_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid chapter limit');
  const pieces: string[] = [];
  for (let offset = 0; offset < content.length; ) {
    const window = content.slice(offset, offset + limit);
    const boundary = Math.max(
      window.lastIndexOf('。'),
      window.lastIndexOf('！'),
      window.lastIndexOf('？'),
      window.lastIndexOf('\n')
    );
    let cut = window.length === limit && boundary > limit / 2 ? boundary + 1 : window.length;
    // Do not put the halves of an astral character in different DB strings.
    const before = content.charCodeAt(offset + cut - 1);
    const after = content.charCodeAt(offset + cut);
    if (cut > 1 && before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) {
      cut -= 1;
    }
    pieces.push(content.slice(offset, offset + cut));
    offset += cut;
  }
  return pieces;
}

function importBlocks(text: string) {
  if (new RegExp(PATTERN_SOURCE, 'm').test(text)) return text.split(chapterSplitPattern);
  // Keep manual separators in the preceding chapter. splitChapters remains a
  // compatibility helper; persistence must not discard any source characters.
  const blocks: string[] = [];
  let offset = 0;
  for (const match of text.matchAll(/\n\s*---+\s*\n/g)) {
    const end = match.index + match[0].length;
    blocks.push(text.slice(offset, end));
    offset = end;
  }
  blocks.push(text.slice(offset));
  return blocks;
}

export function buildImportChapters(text: string, limit = IMPORT_CHAPTER_CONTENT_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid chapter limit');
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!normalized.trim()) throw new Error('没有可导入的内容');
  const chapters: { title?: string; content: string }[] = [];
  for (const block of importBlocks(normalized)) {
    if (!block.length) continue;
    const firstLine = block.trimStart().split('\n')[0] ?? '';
    const title = new RegExp(PATTERN_SOURCE, 'm').test(firstLine)
      ? firstLine.trim().slice(0, 60)
      : undefined;
    for (const [index, content] of splitChapterContent(block, limit).entries()) {
      chapters.push({
        title: title && block.length > limit ? `${title}（${index + 1}）` : title,
        content
      });
    }
  }
  return chapters;
}

/** Never spread a whole multi-megabyte file into one function call. */
export function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}
