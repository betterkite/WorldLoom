import { NextResponse } from 'next/server';
import { detect } from '@/lib/llm/client';
import { listProfileIds, getDefaultProfileId } from '@/lib/llm/config';
import { embeddingConfigSummary } from '@/lib/llm/embeddings';
import { WORLDLOOM_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

/**
 * Health endpoint with LLM connectivity detection (Phase 0 acceptance).
 * Detection results are cached (60s) inside the client, so repeated polls
 * are cheap. A failed detection never turns the service "unhealthy" —
 * browsing/editing work without an LLM by design.
 */
export async function GET() {
  const profileIds = listProfileIds();
  const detections = await Promise.all(profileIds.map((id) => detect(id)));

  return NextResponse.json({
    status: 'ok',
    service: 'worldloom',
    version: WORLDLOOM_VERSION,
    llm: {
      defaultProfile: getDefaultProfileId(),
      profiles: detections,
      embeddings: embeddingConfigSummary()
    },
    timestamp: new Date().toISOString()
  });
}
