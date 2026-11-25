import { describe, expect, it, vi } from 'vitest';
import { parseCompileSubmission, submitCompileBatch } from '@/lib/compile-submission';

const response = (id: string, chunks = 3) => ({ runId: id, run: { id, totalChunks: chunks } });

describe('frontend compile submission contract', () => {
  it('reads the actual finalize response without producing undefined/NaN', () => {
    expect(parseCompileSubmission(response('run-1'))).toEqual({ runId: 'run-1', totalChunks: 3 });
  });
  it.each([
    null,
    {},
    { runId: 'x', totalChunks: 3 },
    response('x', 0),
    response('x', 1.5),
    response('x', Number.NaN),
    { runId: 'x', run: { id: 'other', totalChunks: 3 } }
  ])('rejects malformed or mismatched task responses: %j', (value) => {
    expect(() => parseCompileSubmission(value)).toThrow('编译任务响应无效');
  });
  it('totals confirmed submissions using the nested chunk count', async () => {
    const submit = vi.fn(async (id: string) => response(id));
    expect(await submitCompileBatch(['a', 'b'], submit)).toEqual({
      queued: 2,
      chunks: 6,
      unconfirmed: 0
    });
  });
  it('keeps partial failures visible, including malformed responses, without claiming they were never queued', async () => {
    const submit = vi
      .fn()
      .mockResolvedValueOnce(response('a'))
      .mockRejectedValueOnce(new Error('private provider body'))
      .mockResolvedValueOnce({ runId: 'c', totalChunks: 3 });
    expect(await submitCompileBatch(['a', 'b', 'c'], submit)).toEqual({
      queued: 1,
      chunks: 3,
      unconfirmed: 2
    });
  });
  it('does not mistake zero confirmed submissions for successful compilation', async () => {
    expect(
      await submitCompileBatch(['a'], async () => {
        throw new Error('private body');
      })
    ).toEqual({ queued: 0, chunks: 0, unconfirmed: 1 });
  });
});
