import { z } from 'zod';

const submissionSchema = z.object({
  runId: z.string().min(1),
  run: z.object({ id: z.string().min(1), totalChunks: z.number().int().positive() })
});

/** Finalize returns { runId, run }, not a top-level totalChunks field. */
export function parseCompileSubmission(value: unknown) {
  const result = submissionSchema.safeParse(value);
  if (!result.success || result.data.runId !== result.data.run.id) {
    throw new Error('编译任务响应无效，请刷新检查任务状态');
  }
  return { runId: result.data.runId, totalChunks: result.data.run.totalChunks };
}

export async function submitCompileBatch(
  chapterIds: string[],
  submit: (chapterId: string) => Promise<unknown>
) {
  let queued = 0;
  let chunks = 0;
  let unconfirmed = 0;
  for (const id of chapterIds) {
    try {
      const result = parseCompileSubmission(await submit(id));
      queued += 1;
      chunks += result.totalChunks;
    } catch {
      // The server may have persisted a run before a response/transport failed.
      // Never claim it did not enqueue, or expose an upstream response body.
      unconfirmed += 1;
    }
  }
  return { queued, chunks, unconfirmed };
}
