import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  job: vi.fn(),
  enqueue: vi.fn(),
  run: vi.fn(),
  index: vi.fn(),
  fetch: vi.fn()
}));
vi.mock('@/lib/retrieval/search', () => ({
  getSemanticIndexStatus: mocks.status,
  getSemanticIndexJob: mocks.job,
  enqueueSemanticIndex: mocks.enqueue,
  runSemanticIndexJob: mocks.run,
  indexWorldSemantic: mocks.index
}));
vi.mock('@/lib/llm/embeddings', () => ({
  EmbeddingError: class extends Error {},
  embeddingConfigSummary: () => ({ configured: true })
}));
vi.mock('@/lib/api', () => ({
  errorResponse: () => Response.json({ error: { message: '索引失败' } }, { status: 503 })
}));
import { GET, POST } from '@/app/api/worlds/[worldId]/semantic-index/route';

const params = () => ({ params: Promise.resolve({ worldId: 'synthetic-world' }) });
const semantic = { version: 2, fresh: false, reason: 'stale_index', indexed: 0, expected: 2 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.status.mockResolvedValue(semantic);
  mocks.job.mockResolvedValue(null);
  mocks.enqueue.mockResolvedValue({ id: 'job-1' });
  mocks.run.mockResolvedValue({ id: 'job-1', status: 'completed', indexed: 2 });
});

describe('semantic index read and explicit rebuild boundaries', () => {
  it.each([null, 'queued', 'running', 'failed', 'completed'])(
    'GET only reads stale metadata with existing job status %s',
    async (status) => {
      const job = status ? { id: 'job-1', status, lastHeartbeatAt: new Date(0) } : null;
      mocks.job.mockResolvedValue(job);
      const response = await GET(new Request('http://fixture.invalid'), params());
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(body.semantic).toEqual(semantic);
      expect(body.job?.status ?? null).toBe(status);
      expect(mocks.enqueue).not.toHaveBeenCalled();
      expect(mocks.run).not.toHaveBeenCalled();
      expect(mocks.index).not.toHaveBeenCalled();
    }
  );

  it('POST explicitly retries and runs the current-version job', async () => {
    const response = await POST(
      new Request('http://fixture.invalid', { method: 'POST' }),
      params()
    );
    expect(mocks.enqueue).toHaveBeenCalledWith('synthetic-world', 2, { manualRetry: true });
    expect(mocks.run).toHaveBeenCalledWith('job-1');
    expect(mocks.index).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ indexed: 2, job: { status: 'completed' } });
  });

  it('a failed manual rebuild is an error rather than a completed index', async () => {
    mocks.run.mockResolvedValue({ status: 'failed', error: 'embedding_unavailable', indexed: 0 });
    const response = await POST(
      new Request('http://fixture.invalid', { method: 'POST' }),
      params()
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { message: '索引失败' } });
    expect(mocks.index).not.toHaveBeenCalled();
  });
});
