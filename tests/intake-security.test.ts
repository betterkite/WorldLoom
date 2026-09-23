import { describe, expect, it } from 'vitest';
import { errorResponse, readJsonBody, readTextBody } from '@/lib/api';
import { GovernanceError } from '@/lib/governance/changes';
import { assertSafeRemoteUrl } from '@/lib/intake/url-safety';
import { EmbeddingError } from '@/lib/llm/embeddings';

describe('intake and API security boundaries', () => {
  it('rejects private, local, credentialed, and non-standard outbound URLs', async () => {
    for (const value of [
      'http://127.0.0.1/metadata',
      'http://10.0.0.8/internal',
      'http://[::1]/internal',
      'http://[::ffff:127.0.0.1]/internal',
      'http://localhost:4310/',
      'http://user:password@1.1.1.1/',
      'http://1.1.1.1:8080/'
    ]) {
      await expect(assertSafeRemoteUrl(value)).rejects.toBeInstanceOf(GovernanceError);
    }
  });

  it('allows a public IP over a standard HTTP(S) port', async () => {
    await expect(assertSafeRemoteUrl('https://1.1.1.1/')).resolves.toMatchObject({
      protocol: 'https:',
      hostname: '1.1.1.1'
    });
  });

  it('caps request bodies by actual UTF-8 bytes and reports malformed JSON safely', async () => {
    const oversized = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ content: '界'.repeat(100) })
    });
    await expect(readJsonBody(oversized, 100)).rejects.toMatchObject({
      code: 'payload_too_large'
    });

    const malformed = new Request('http://localhost', {
      method: 'POST',
      body: '{"content":'
    });
    await expect(readJsonBody(malformed, 100)).rejects.toMatchObject({ code: 'invalid_json' });

    const oversizedText = new Request('http://localhost', {
      method: 'POST',
      body: '界'.repeat(100)
    });
    await expect(readTextBody(oversizedText, 100)).rejects.toMatchObject({
      code: 'payload_too_large'
    });
  });

  it('does not expose raw unexpected exception messages to API callers', async () => {
    const response = errorResponse(new Error('database password leaked'));
    expect(response.status).toBe(500);
    expect(response.headers.get('x-correlation-id')).toBeTruthy();
    const body = await response.json();
    expect(body.error.message).not.toContain('database password');
    expect(body.error.code).toBe('internal_error');

    const governanceResponse = errorResponse(
      new GovernanceError('invalid_change', 'provider token should not be returned')
    );
    const governanceBody = await governanceResponse.json();
    expect(governanceBody.error.message).not.toContain('provider token');
  });

  it('maps upstream embedding failures to safe retryable responses', async () => {
    const response = errorResponse(
      new EmbeddingError('embedding_upstream_error', 'provider body contains account details', {
        status: 402
      })
    );
    expect(response.status).toBe(502);
    expect(response.headers.get('retry-after')).toBeNull();
    const body = await response.json();
    expect(body.error.code).toBe('embedding_upstream_unavailable');
    expect(body.error.message).not.toContain('account details');
    expect(body.error.correlationId).toBeTruthy();
  });
});
