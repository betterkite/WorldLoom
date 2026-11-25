import { NextResponse } from 'next/server';
import {
  enqueueSemanticIndex,
  getSemanticIndexJob,
  getSemanticIndexStatus,
  indexWorldSemantic,
  runSemanticIndexJob
} from '@/lib/retrieval/search';
import { errorResponse } from '@/lib/api';
import { EmbeddingError, embeddingConfigSummary } from '@/lib/llm/embeddings';

type Params = { params: Promise<{ worldId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { worldId } = await params;
    const semantic = await getSemanticIndexStatus(worldId);
    // Reading stale/legacy metadata must not start expensive model inference.
    const job = await getSemanticIndexJob(worldId, semantic.version);
    return NextResponse.json({ semantic, job }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** (Re-)embed world content for semantic retrieval. 202 when indexing, graceful when unconfigured. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { worldId } = await params;
    const before = await getSemanticIndexStatus(worldId);
    // A manual refresh is also the explicit retry action for a failed job.
    const job = await enqueueSemanticIndex(worldId, before.version, { manualRetry: true });
    const execution = job ? await runSemanticIndexJob(job.id) : null;
    if (execution?.status === 'failed') {
      const upstreamStatus = execution.error?.match(/^embedding_upstream_error \((\d{3})\)$/)?.[1];
      const error = upstreamStatus
        ? new EmbeddingError('embedding_upstream_error', 'Semantic indexing failed', {
            status: Number(upstreamStatus)
          })
        : new EmbeddingError('embedding_upstream_error', 'Semantic indexing failed');
      return errorResponse(error);
    }
    const result = execution
      ? {
          indexed: execution.indexed,
          skipped: false
        }
      : await indexWorldSemantic(worldId);
    return NextResponse.json(
      { ...result, ...(execution ? { job: execution } : {}), embedding: embeddingConfigSummary() },
      { status: result.skipped ? 200 : 202 }
    );
  } catch (error) {
    if (error instanceof EmbeddingError) {
      return errorResponse(error);
    }
    return errorResponse(error);
  }
}
