import { llmUsageSummarySchema, type LlmUsageSummary } from '@/lib/llm/usage-summary';

// Read-interface resource bounds, not token/spending quotas. Never truncate a
// summary or substitute zero when the complete response cannot be validated.
export const LLM_USAGE_READ_TIMEOUT_MS = 10_000;
export const LLM_USAGE_RESPONSE_MAX_BYTES = 256 * 1024;
type ReadFailure = 'unavailable' | 'invalid' | 'timeout' | 'cancelled' | 'too_large';
const MESSAGES: Record<ReadFailure, string> = {
  unavailable: '累计模型用量暂时无法读取',
  invalid: '累计模型用量响应格式无效',
  timeout: '累计模型用量读取超时，请稍后刷新',
  cancelled: '累计模型用量读取已取消',
  too_large: '累计模型用量响应过大，请检查服务后刷新'
};

export class LlmUsageReadError extends Error {
  constructor(readonly code: ReadFailure) {
    super(MESSAGES[code]);
    this.name = 'LlmUsageReadError';
  }
}

function cancelBody(body: ReadableStream<Uint8Array> | null) {
  // Cancellation is best effort, never another unbounded awaited operation.
  if (body && !body.locked) void body.cancel().catch(() => {});
}

async function readSummary(response: Response, signal: AbortSignal): Promise<LlmUsageSummary> {
  if (signal.aborted) {
    cancelBody(response.body);
    throw new LlmUsageReadError('cancelled');
  }
  if (!response.ok) {
    cancelBody(response.body);
    throw new LlmUsageReadError('unavailable');
  }
  const declared = response.headers.get('content-length');
  // This small byte threshold is exactly representable; huge numeric headers
  // become Infinity and are also rejected. Do not allocate arbitrary BigInts.
  if (declared && /^\d+$/.test(declared) && Number(declared) > LLM_USAGE_RESPONSE_MAX_BYTES) {
    cancelBody(response.body);
    throw new LlmUsageReadError('too_large');
  }
  if (!response.body) throw new LlmUsageReadError('invalid');
  const reader = response.body.getReader();
  const cancelReader = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancelReader, { once: true });
  // One bounded buffer, not an unbounded array of tiny streamed chunks.
  const bytes = new Uint8Array(LLM_USAGE_RESPONSE_MAX_BYTES);
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (signal.aborted) throw new LlmUsageReadError('cancelled');
      if (part.done) break;
      const next = size + part.value.byteLength;
      if (next > LLM_USAGE_RESPONSE_MAX_BYTES) throw new LlmUsageReadError('too_large');
      bytes.set(part.value, size);
      size = next;
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelReader);
    reader.releaseLock();
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
  } catch {
    // Do not preserve SyntaxError text: it may quote a private response body.
    throw new LlmUsageReadError('invalid');
  }
  const parsed = llmUsageSummarySchema.safeParse(payload);
  if (!parsed.success) throw new LlmUsageReadError('invalid');
  return parsed.data;
}

export async function fetchLlmUsage({
  signal
}: { signal?: AbortSignal } = {}): Promise<LlmUsageSummary> {
  if (signal?.aborted) throw new LlmUsageReadError('cancelled');
  const controller = new AbortController();
  let stopped: LlmUsageReadError | null = null;
  let rejectStop!: (error: LlmUsageReadError) => void;
  const interruption = new Promise<never>((_resolve, reject) => {
    rejectStop = reject;
  });
  const stop = (code: 'timeout' | 'cancelled') => {
    if (stopped) return;
    stopped = new LlmUsageReadError(code);
    // Reject even if a broken fetch/stream ignores abort. Aborting the browser
    // request does not attest that the server's underlying SQL was cancelled.
    rejectStop(stopped);
    controller.abort();
  };
  const cancel = () => stop('cancelled');
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => stop('timeout'), LLM_USAGE_READ_TIMEOUT_MS);
  try {
    const read = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) throw new LlmUsageReadError('cancelled');
        return fetch('/api/llm/usage', { cache: 'no-store', signal: controller.signal });
      })
      .then((response) => readSummary(response, controller.signal));
    return await Promise.race([read, interruption]);
  } catch (error) {
    if (stopped) throw stopped;
    if (error instanceof LlmUsageReadError) throw error;
    throw new LlmUsageReadError('unavailable');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}
