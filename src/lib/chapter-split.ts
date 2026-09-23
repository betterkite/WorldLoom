/**
 * 章节标题切分（C-2/ISS 系列修复）：
 * 识别 第X章 / 第X回 / 第X节 / 第【N】段 / 第（N）话 等变体（含全角括号与空格）。
 * 用 RegExp 构造器以避免 .tsx 行内正则的转义层级问题。
 */
const PATTERN_SOURCE =
  '\\n(?=\\s*第\\s*[【\\[（(]?\\s*[一二三四五六七八九十百千零两0-9]+\\s*[】\\]）)]?\\s*[段回章节话])';

export const chapterSplitPattern = new RegExp(PATTERN_SOURCE, 'g');

export function splitChapters(text: string): string[] {
  if (/\n\s*---+\s*\n/.test(text)) {
    return text.split(/\n\s*---+\s*\n/);
  }
  return text.split(chapterSplitPattern);
}
