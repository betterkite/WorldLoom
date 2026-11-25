import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/worldbuilding/manuscript', () => ({
  createManuscript: vi.fn(),
  listManuscripts: vi.fn()
}));

import { GET as listManuscriptsRoute } from '@/app/api/worlds/[worldId]/manuscripts/route';
import { listManuscripts } from '@/lib/worldbuilding/manuscript';
import { errorResponse } from '@/lib/api';
import { GovernanceError } from '@/lib/governance/changes';
import { LlmError } from '@/lib/llm/client';
import { LlmConfigError } from '@/lib/llm/config';
import { LlmUsageBudgetError } from '@/lib/llm/usage-budget';

describe('unexpected API error diagnostics', () => {
  const privateError = new Error('private-message-sentinel', {
    cause: new Error('private-cause-sentinel')
  });
  privateError.name = 'private-name-sentinel';
  privateError.stack = 'private-stack-sentinel';
  const privateObject = {
    password: 'private-password-sentinel',
    providerBody: 'private-provider-body-sentinel'
  };
  const getter = vi.fn(() => {
    throw new Error('private-getter-sentinel');
  });
  const unreadableObject = Object.defineProperty({}, 'message', { get: getter });

  it.each([
    { label: 'Error with stack and cause', error: privateError },
    { label: 'non-Error object', error: privateObject },
    { label: 'string', error: 'private-string-sentinel' },
    { label: 'null', error: null },
    { label: 'undefined', error: undefined },
    { label: 'object with throwing message getter', error: unreadableObject }
  ])('logs only a fixed code and response correlation for $label', async ({ error }) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = errorResponse(error);
      const body = await response.json();
      expect(response.status).toBe(500);
      expect(body.error.code).toBe('internal_error');
      expect(response.headers.get('x-correlation-id')).toBe(body.error.correlationId);
      expect(body.error.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith('[api] unhandled error', {
        code: 'internal_error',
        correlationId: body.error.correlationId
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain('private-');
      expect(JSON.stringify(body)).not.toContain('private-');
      expect(getter).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe('manuscript list error diagnostics', () => {
  const request = new NextRequest('http://localhost/api/worlds/fixture/manuscripts');
  const list = vi.mocked(listManuscripts);

  beforeEach(() => {
    list.mockReset();
  });

  const getter = vi.fn(() => {
    throw new Error('private-diagnostic-getter-sentinel');
  });
  const unreadableError = Object.defineProperty(new Error(), 'message', { get: getter });

  it.each([
    { label: 'legacy diagnostic marker', error: new Error('[import-diag] private-body-sentinel') },
    { label: 'ordinary failure', error: new Error('private-database-sentinel') },
    { label: 'throwing message getter', error: unreadableError }
  ])('uses only shared sanitized diagnostics for $label', async ({ error }) => {
    list.mockRejectedValue(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await listManuscriptsRoute(request, {
        params: Promise.resolve({ worldId: 'fixture' })
      });
      const body = await response.json();
      expect(response.status).toBe(500);
      expect(body.error.code).toBe('internal_error');
      expect(response.headers.get('x-correlation-id')).toBe(body.error.correlationId);
      expect(list).toHaveBeenCalledWith('fixture');
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith('[api] unhandled error', {
        code: 'internal_error',
        correlationId: body.error.correlationId
      });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-|import-diag/);
      expect(JSON.stringify(body)).not.toMatch(/private-|import-diag/);
      expect(getter).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('preserves successful list responses without error logging', async () => {
    list.mockResolvedValue([]);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await listManuscriptsRoute(request, {
        params: Promise.resolve({ worldId: 'fixture' })
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ manuscripts: [] });
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('keeps missing-world responses at 404 without private diagnostics', async () => {
    list.mockRejectedValue(new GovernanceError('world_not_found', 'private-world-sentinel'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await listManuscriptsRoute(request, {
        params: Promise.resolve({ worldId: 'fixture' })
      });
      expect(response.status).toBe(404);
      expect(JSON.stringify(await response.json())).not.toContain('private-');
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe('public model error responses', () => {
  it('reports a response byte overflow as a resource failure, not spending exhaustion or automatic retry', async () => {
    const response = errorResponse(
      new LlmError('llm_response_too_large', 'private-profile', 'private-wire-body-sentinel')
    );
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.error.code).toBe('llm_response_too_large');
    expect(body.error.message).toContain('读取资源');
    expect(body.error.message).not.toContain('预算');
    expect(JSON.stringify(body)).not.toContain('private');
    expect(response.headers.get('retry-after')).toBeNull();
    expect(response.headers.get('x-correlation-id')).toBe(body.error.correlationId);
  });

  it('reports invalid budget configuration without leaking values or suggesting automatic retry', async () => {
    const response = errorResponse(
      new LlmConfigError('llm_budget_config_invalid', 'private deployment value sentinel')
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('llm_budget_config_invalid');
    expect(body.error.message).toContain('配置');
    expect(JSON.stringify(body)).not.toContain('private');
    expect(response.headers.get('retry-after')).toBeNull();
    expect(response.headers.get('x-correlation-id')).toBe(body.error.correlationId);
  });

  it.each([
    new LlmError('llm_budget_exceeded', 'private-profile', 'private ledger details'),
    new LlmUsageBudgetError('private-operation', 'private-profile', 'private usage details')
  ])('returns a non-retryable, sanitized 429 for $name', async (error) => {
    const response = errorResponse(error);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error.code).toBe('llm_budget_exceeded');
    expect(body.error.message).toContain('预算');
    expect(body.error.message).toContain('用量');
    expect(JSON.stringify(body)).not.toContain('private');
    expect(response.headers.get('retry-after')).toBeNull();
    expect(body.error.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(response.headers.get('x-correlation-id')).toBe(body.error.correlationId);
  });

  it.each([
    {
      error: new LlmError('llm_upstream_error', 'private-profile', 'private response', {
        status: 402
      }),
      status: 502,
      retryAfter: null
    },
    {
      error: new LlmError('llm_upstream_error', 'private-profile', 'private response', {
        status: 503
      }),
      status: 503,
      retryAfter: '60'
    },
    {
      error: new LlmError('llm_timeout', 'private-profile', 'private timeout'),
      status: 503,
      retryAfter: '60'
    }
  ])('preserves provider failure status $status', async ({ error, status, retryAfter }) => {
    const response = errorResponse(error);
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body.error.code).toBe('llm_upstream_unavailable');
    expect(response.headers.get('retry-after')).toBe(retryAfter);
    expect(JSON.stringify(body)).not.toContain('private');
    expect(response.headers.get('x-correlation-id')).toBe(body.error.correlationId);
  });
});
