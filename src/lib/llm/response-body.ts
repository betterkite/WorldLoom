// Wire-response safety, not a token or spending quota. Reject whole payloads;
// never trim completion/usage or substitute partial/unknown data with zero.
export const CHAT_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
export const EMBEDDING_RESPONSE_MAX_BYTES = 16 * 1024 * 1024;
type ResponseFailure = 'invalid' | 'too_large' | 'aborted';
const MESSAGES: Record<ResponseFailure, string> = {
  invalid: 'Provider response could not be decoded',
  too_large: 'Provider response exceeded the read resource limit',
  aborted: 'Provider response reading was interrupted'
};
export class ProviderResponseError extends Error {
  constructor(readonly code: ResponseFailure) {
    super(MESSAGES[code]);
    this.name = 'ProviderResponseError';
  }
}

function bestEffort(action: () => unknown): void {
  void Promise.resolve()
    .then(action)
    .catch(() => {});
}

/** Disposal never delays feedback or reveals raw cancel errors. Abort merely
 * requests cancellation; it is not proof of provider/connection/billing stop.
 */
export function discardProviderResponse(controller: AbortController, response: Response): void {
  controller.abort();
  bestEffort(() => response.body?.cancel());
}

/** A bounded growing buffer, no unbounded chunk array. The caller owns the
 * fetch deadline/transport controller. Race an abort even when read ignores it,
 * release our buffer/lock on return, and handle late failures without raw cause.
 * Expansion/decoding/JSON allocations and transport chunks are not a heap cap.
 */
export async function readProviderJson(
  response: Response,
  signal: AbortSignal,
  maxBytes = CHAT_RESPONSE_MAX_BYTES
): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let bytes: Uint8Array | undefined;
  let interrupted = signal.aborted;
  let rejectAbort!: (error: ProviderResponseError) => void;
  const interruption = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  // Also observe early interruption if a nonstandard response accessor throws
  // before the race is attached; never retain its private exception as cause.
  void interruption.catch(() => {});
  const stop = () => {
    interrupted = true;
    rejectAbort(new ProviderResponseError('aborted'));
  };
  const dispose = () => {
    const ownedReader = reader;
    if (ownedReader) {
      // Request cancel before releasing the lock; do not await its promise.
      try {
        void ownedReader.cancel().catch(() => {});
      } catch {
        /* Best effort. */
      }
      // releaseLock also rejects any pending read. The read Promise is already
      // observed by the race, so a late rejection cannot become unhandled.
      try {
        ownedReader.releaseLock();
      } catch {
        /* No stronger release claim. */
      }
      reader = undefined;
    } else {
      bestEffort(() => response.body?.cancel());
    }
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    if (interrupted || signal.aborted) throw new ProviderResponseError('aborted');
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes <= 0 ||
      maxBytes > EMBEDDING_RESPONSE_MAX_BYTES
    ) {
      throw new ProviderResponseError('invalid');
    }
    const declared = response.headers.get('content-length');
    if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
      throw new ProviderResponseError('too_large');
    }
    if (!response.body) throw new ProviderResponseError('invalid');
    reader = response.body.getReader();
    bytes = new Uint8Array(Math.min(16 * 1024, maxBytes));
    const read = async () => {
      let size = 0;
      while (true) {
        const part = await reader!.read();
        if (interrupted || signal.aborted) throw new ProviderResponseError('aborted');
        if (part.done) break;
        if (!(part.value instanceof Uint8Array)) throw new ProviderResponseError('invalid');
        const next = size + part.value.byteLength;
        if (next > maxBytes) throw new ProviderResponseError('too_large');
        if (next > bytes!.byteLength) {
          let capacity = bytes!.byteLength;
          while (capacity < next) capacity = Math.min(maxBytes, capacity * 2);
          const expanded = new Uint8Array(capacity);
          expanded.set(bytes!.subarray(0, size));
          bytes = expanded;
        }
        bytes!.set(part.value, size);
        size = next;
      }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes!.subarray(0, size));
        return JSON.parse(text) as unknown;
      } catch {
        throw new ProviderResponseError('invalid');
      }
    };
    return await Promise.race([read(), interruption]);
  } catch (error) {
    if (interrupted || signal.aborted) throw new ProviderResponseError('aborted');
    if (error instanceof ProviderResponseError) throw error;
    throw new ProviderResponseError('invalid');
  } finally {
    signal.removeEventListener('abort', stop);
    bytes = undefined;
    dispose();
  }
}
