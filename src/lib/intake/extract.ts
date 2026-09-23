import { GovernanceError } from '@/lib/governance/changes';

/**
 * C-4 文档摄入：PDF（unpdf 抽文本）与 EPUB（fflate 解包 + XHTML 转文本）。
 * 统一输出 markdown 相近日志文本，交给素材管线（去重 → 编译）。
 */

export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    const content = String(text ?? '').trim();
    if (!content)
      throw new GovernanceError('empty_document', 'PDF 未提取到文本（可能是扫描件，需 OCR）');
    return content;
  } catch (error) {
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError('document_parse_failed', `PDF 解析失败：${(error as Error).message}`);
  }
}

export async function extractEpubText(buffer: Buffer): Promise<string> {
  try {
    const { unzipSync, strFromU8 } = await import('fflate');
    const files = unzipSync(new Uint8Array(buffer));
    const sections: string[] = [];
    for (const [name, data] of Object.entries(files)) {
      if (!/\.(x?html?|xhtml)$/i.test(name)) continue;
      const html = strFromU8(data as Uint8Array);
      const text = htmlToText(html);
      if (text.trim())
        sections.push(
          `# ${
            name
              .split('/')
              .pop()
              ?.replace(/\.x?html?$/i, '') ?? name
          }\n\n${text}`
        );
    }
    const content = sections.join('\n\n').trim();
    if (!content) throw new GovernanceError('empty_document', 'EPUB 未提取到文本内容');
    return content;
  } catch (error) {
    if (error instanceof GovernanceError) throw error;
    throw new GovernanceError(
      'document_parse_failed',
      `EPUB 解析失败：${(error as Error).message}`
    );
  }
}

export async function extractDocumentText(
  buffer: Buffer,
  filename: string,
  mediaType?: string
): Promise<string> {
  const lower = filename.toLowerCase();
  if (mediaType === 'application/pdf' || lower.endsWith('.pdf')) return extractPdfText(buffer);
  if (mediaType === 'application/epub+zip' || lower.endsWith('.epub'))
    return extractEpubText(buffer);
  if (/\.(md|txt|markdown)$/i.test(lower) || mediaType?.startsWith('text/'))
    return buffer.toString('utf8');
  throw new GovernanceError(
    'unsupported_media_type',
    `暂不支持的文件类型：${mediaType ?? filename}`
  );
}

function htmlToText(html: string): string {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_m, level, text) => `\n${'#'.repeat(Number(level))} ${strip(text)}\n`
    )
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function strip(value: string): string {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
