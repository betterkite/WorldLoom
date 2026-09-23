import { prisma } from '@/lib/db/client';
import { newUid } from '@/lib/uid';
import { GovernanceError, requireWorld } from '@/lib/governance/changes';
import { createHash } from 'node:crypto';
import { MAX_SOURCE_CONTENT_BYTES, MAX_URL_RESPONSE_BYTES, formatBytes } from './limits';
import { assertSafeRemoteUrl } from './url-safety';

/**
 * Raw source intake (Phase 1: store + dedupe only; LLM compilation in Phase 2
 * turns sources into entity/event changes through the governance chain).
 */

export async function createSource(
  worldId: string,
  input: {
    filename?: string;
    content: string;
    mediaType?: string;
    author?: string;
    force?: boolean;
  }
) {
  await requireWorld(worldId);
  const content = String(input.content ?? '');
  if (!content.trim()) throw new GovernanceError('empty_source', 'Source content is empty');
  const contentBytes = Buffer.byteLength(content, 'utf8');
  if (contentBytes > MAX_SOURCE_CONTENT_BYTES) {
    throw new GovernanceError(
      'payload_too_large',
      `Source content exceeds ${formatBytes(MAX_SOURCE_CONTENT_BYTES)}`
    );
  }

  const contentHash = createHash('sha256').update(content).digest('hex');
  const existing = await prisma.source.findUnique({
    where: { worldId_contentHash: { worldId, contentHash } }
  });
  if (existing && !input.force) {
    return { source: existing, skipped: true as const, reason: 'duplicate_content' };
  }
  if (existing && input.force) {
    await prisma.source.delete({ where: { id: existing.id } });
  }

  const source = await prisma.source.create({
    data: {
      worldId,
      uid: newUid('src'),
      filename: (input.filename ?? 'paste.md').slice(0, 200),
      mediaType: input.mediaType ?? 'text/markdown',
      content,
      contentHash,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      author: input.author ?? 'local-user',
      status: 'staged'
    }
  });
  return { source, skipped: false as const };
}

export async function listSources(worldId: string) {
  await requireWorld(worldId);
  return prisma.source.findMany({
    where: { worldId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      uid: true,
      filename: true,
      mediaType: true,
      sizeBytes: true,
      status: true,
      author: true,
      createdAt: true
    }
  });
}

/** B-4：抓取 URL 并转为可编译文本（去脚本/样式，保留标题层级与段落）。 */
export async function fetchUrlAsText(
  url: string
): Promise<{ title: string | null; content: string }> {
  let current = url;
  let response: Response | null = null;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const safeUrl = await assertSafeRemoteUrl(current);
    try {
      response = await fetch(safeUrl, {
        headers: { 'user-agent': 'WorldLoom/1.0 (+local)' },
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000)
      });
    } catch {
      throw new GovernanceError('url_fetch_failed', '远程页面抓取失败');
    }
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    if (!location || redirect === 3) {
      throw new GovernanceError('url_fetch_failed', '重定向次数超过安全上限');
    }
    current = new URL(location, safeUrl).toString();
  }
  if (!response) throw new GovernanceError('url_fetch_failed', '远程页面抓取失败');
  if (!response.ok) throw new GovernanceError('url_fetch_failed', `抓取返回 ${response.status}`);
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_URL_RESPONSE_BYTES) {
    throw new GovernanceError('payload_too_large', '远程页面超过大小限制');
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_URL_RESPONSE_BYTES) {
        await reader.cancel();
        throw new GovernanceError('payload_too_large', '远程页面超过大小限制');
      }
      chunks.push(value);
    }
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const html = new TextDecoder().decode(body);
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? htmlToText(titleMatch[1]).trim() || null : null;
  return { title, content: htmlToText(html) };
}

function htmlToText(html: string): string {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_m, level, text) => `${'#'.repeat(Number(level))} ${strip(text)}\n\n`
    )
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, item) => `- ${strip(item)}\n`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, para) => `${strip(para)}\n\n`)
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
