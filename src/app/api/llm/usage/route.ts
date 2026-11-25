import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { readLlmUsageSummary } from '@/lib/llm/usage-tracking';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Read persisted local statistics only. Never call /models or completions. */
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    return NextResponse.json(await readLlmUsageSummary(), { headers });
  } catch {
    const correlationId = randomUUID();
    return NextResponse.json(
      {
        error: {
          code: 'llm_usage_unavailable',
          message: '累计模型用量暂时无法读取；请检查数据库和迁移后重试',
          correlationId
        }
      },
      { status: 503, headers: { ...headers, 'x-correlation-id': correlationId } }
    );
  }
}
