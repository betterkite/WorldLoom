import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_RESPONSE_MAX_BYTES,
  EMBEDDING_RESPONSE_MAX_BYTES,
  ProviderResponseError,
  readProviderJson
} from '@/lib/llm/response-body';

afterEach(() => vi.restoreAllMocks());
const controller = () => new AbortController();
async function failure(response: Response, signal = controller().signal) {
  try {
    await readProviderJson(response, signal);
  } catch (error) {
    return error;
  }
  throw new Error('Expected a reader failure');
}

describe('provider success JSON read resource boundary, synthetic streams only', () => {
  it.each([0, -1, 1.5, NaN, Infinity, EMBEDDING_RESPONSE_MAX_BYTES + 1])(
    'refuses an invalid explicit read ceiling without acquiring a reader: %s',
    async (limit) => {
      const response = new Response('{}');
      const getReader = vi.spyOn(response.body!, 'getReader');
      await expect(readProviderJson(response, controller().signal, limit)).rejects.toMatchObject({
        code: 'invalid'
      });
      expect(getReader).not.toHaveBeenCalled();
    }
  );

  it('checks a caller-specific ceiling without widening the chat default', async () => {
    const input = '{}  ';
    await expect(readProviderJson(new Response(input), controller().signal, 4)).resolves.toEqual(
      {}
    );
    await expect(
      readProviderJson(new Response(input), controller().signal, 3)
    ).rejects.toMatchObject({ code: 'too_large' });
    const larger = `0${' '.repeat(CHAT_RESPONSE_MAX_BYTES)}`;
    await expect(
      readProviderJson(new Response(larger), controller().signal, EMBEDDING_RESPONSE_MAX_BYTES)
    ).resolves.toBe(0);
    await expect(readProviderJson(new Response(larger), controller().signal)).rejects.toMatchObject(
      { code: 'too_large' }
    );
  });

  it('preserves a whole Unicode payload without response.json or partial truncation', async () => {
    const input = {
      choices: [{ message: { content: '合成内容 🌍' } }],
      usage: { prompt_tokens: 3, completion_tokens: 4 }
    };
    const bytes = new TextEncoder().encode(JSON.stringify(input));
    const split = bytes.findIndex((byte) => byte >= 0x80) + 1;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(bytes.slice(0, split));
          stream.enqueue(bytes.slice(split));
          stream.close();
        }
      })
    );
    const json = vi.spyOn(response, 'json');
    await expect(readProviderJson(response, controller().signal)).resolves.toEqual(input);
    expect(json).not.toHaveBeenCalled();
    expect(response.body?.locked).toBe(false);
  });

  it.each([undefined, '1', 'untrusted-length', '-1'])(
    'checks actual streamed bytes regardless of declared length: %s',
    async (length) => {
      const cancelled = vi.fn();
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(new Uint8Array(CHAT_RESPONSE_MAX_BYTES));
            stream.enqueue(new Uint8Array([32]));
          },
          cancel: cancelled
        }),
        { headers: length === undefined ? {} : { 'content-length': length } }
      );
      await expect(readProviderJson(response, controller().signal)).rejects.toMatchObject({
        code: 'too_large'
      });
      expect(cancelled).toHaveBeenCalledTimes(1);
      expect(response.body?.locked).toBe(false);
    }
  );

  it('rejects a declared excessive size without reading or waiting on cancellation', async () => {
    const cancelled = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream({ cancel: cancelled }), {
      headers: { 'content-length': String(CHAT_RESPONSE_MAX_BYTES + 1) }
    });
    const getReader = vi.spyOn(response.body!, 'getReader');
    await expect(readProviderJson(response, controller().signal)).rejects.toMatchObject({
      code: 'too_large'
    });
    expect(getReader).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('accepts exactly the wire ceiling and expands a bounded buffer for many small chunks', async () => {
    const payload = new TextEncoder().encode(`0${' '.repeat(CHAT_RESPONSE_MAX_BYTES - 1)}`);
    let position = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(stream) {
          if (position === payload.length) {
            stream.close();
            return;
          }
          const next = Math.min(position + 4093, payload.length);
          stream.enqueue(payload.subarray(position, next));
          position = next;
        }
      })
    );
    await expect(readProviderJson(response, controller().signal)).resolves.toBe(0);
    expect(response.body?.locked).toBe(false);
  });

  it.each([
    new Uint8Array([0xc3, 0x28]),
    new TextEncoder().encode('<private-json-body-sentinel>'),
    new Uint8Array()
  ])('withholds malformed UTF-8/JSON and empty body details: %#', async (bytes) => {
    const error = await failure(new Response(bytes));
    expect(error).toBeInstanceOf(ProviderResponseError);
    expect(error).toMatchObject({ code: 'invalid' });
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toContain('private-json-body-sentinel');
  });

  it('rejects an absent body and an already interrupted request without touching a reader', async () => {
    await expect(
      readProviderJson(new Response(null, { status: 204 }), controller().signal)
    ).rejects.toMatchObject({ code: 'invalid' });
    const aborted = controller();
    aborted.abort(new Error('private-abort-reason-sentinel'));
    const response = new Response('{}');
    const reader = vi.spyOn(response.body!, 'getReader');
    const error = await failure(response, aborted.signal);
    expect(error).toMatchObject({ code: 'aborted' });
    expect(String(error)).not.toContain('private-abort-reason-sentinel');
    expect(reader).not.toHaveBeenCalled();
  });

  it('races interruption of a stalled body and releases listener/lock without waiting on cancel', async () => {
    const abort = controller();
    const removed = vi.spyOn(abort.signal, 'removeEventListener');
    const cancelled = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream({ cancel: cancelled }));
    const observed = expect(readProviderJson(response, abort.signal)).rejects.toMatchObject({
      code: 'aborted'
    });
    abort.abort(new Error('private-abort-reason-sentinel'));
    await observed;
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(response.body?.locked).toBe(false);
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('handles a nonstandard reader that ignores interruption and rejects late without leaking details', async () => {
    const abort = controller();
    let rejectLate!: (error: Error) => void;
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const releaseLock = vi.fn();
    const response = new Response('');
    vi.spyOn(response.body!, 'getReader').mockReturnValue({
      read: vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            rejectLate = reject;
          })
      ),
      cancel,
      releaseLock
    } as unknown as ReadableStreamDefaultReader<Uint8Array>);
    const pending = readProviderJson(response, abort.signal);
    const observed = expect(pending).rejects.toMatchObject({ code: 'aborted' });
    abort.abort();
    await observed;
    rejectLate(new Error('private-stream-late-sentinel'));
    await Promise.resolve();
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it.each(['reject', 'throw'] as const)(
    'keeps a %s-ing cleanup private and preserves the read failure',
    async (mode) => {
      const response = new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode('<private-body-sentinel>'));
            stream.error(new Error('private-stream-sentinel'));
          }
        })
      );
      const getReader = response.body!.getReader.bind(response.body);
      vi.spyOn(response.body!, 'getReader').mockImplementation(() => {
        const reader = getReader();
        vi.spyOn(reader, 'cancel').mockImplementation(() => {
          const error = new Error('private-cancel-sentinel');
          if (mode === 'throw') throw error;
          return Promise.reject(error);
        });
        return reader;
      });
      const error = await failure(response);
      expect(error).toMatchObject({ code: 'invalid' });
      expect(String(error)).not.toContain('private');
      expect(error).not.toHaveProperty('cause');
      expect(response.body?.locked).toBe(false);
    }
  );
});
