import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { GovernanceError } from '@/lib/governance/changes';
import { ZodError } from 'zod';
import { EmbeddingError } from '@/lib/llm/embeddings';
import { LlmError } from '@/lib/llm/client';
import { LlmConfigError } from '@/lib/llm/config';
import { LlmUsageBudgetError } from '@/lib/llm/usage-budget';

const STATUS_BY_CODE: Record<string, number> = {
  world_not_found: 404,
  source_not_found: 404,
  version_not_found: 404,
  entity_not_found: 404,
  event_not_found: 404,
  chapter_not_found: 404,
  manuscript_not_found: 404,
  compile_run_not_found: 404,
  change_not_found: 404,
  invalid_world: 400,
  invalid_change: 400,
  invalid_payload: 400,
  invalid_rollback: 400,
  invalid_json: 400,
  invalid_url: 400,
  compile_budget_exceeded: 429,
  embedding_upstream_unavailable: 503,
  llm_upstream_unavailable: 503,
  empty_source: 400,
  payload_too_large: 413,
  document_parse_failed: 422,
  unsupported_media_type: 415,
  url_fetch_failed: 502,
  change_immutable: 409,
  revision_conflict: 409,
  legacy_time_cursor: 409,
  ambiguous_latest_event: 409,
  invalid_time_cursor: 400,
  nothing_to_merge: 409,
  compile_run_active: 409,
  compile_run_completed: 409,
  compile_stale_world: 409,
  unknown_epoch: 400
};

export function errorResponse(error: unknown): NextResponse {
  const correlationId = randomUUID();
  if (error instanceof GovernanceError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: publicMessage(error.code),
          ...(error.details ? { details: error.details } : {}),
          correlationId
        }
      },
      { status: STATUS_BY_CODE[error.code] ?? 400, headers: { 'x-correlation-id': correlationId } }
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: 'Request body is invalid',
          details: error.issues,
          correlationId
        }
      },
      { status: 400, headers: { 'x-correlation-id': correlationId } }
    );
  }
  if (error instanceof EmbeddingError) {
    const status = error.code === 'embedding_upstream_error' && error.status === 402 ? 502 : 503;
    return providerErrorResponse(
      'embedding_upstream_unavailable',
      '语义索引上游暂不可用，已保留词法检索能力',
      status,
      correlationId,
      status === 503
    );
  }
  if (error instanceof LlmConfigError && error.code === 'llm_budget_config_invalid') {
    return providerErrorResponse(
      'llm_budget_config_invalid',
      '模型预算配置无效；已停止当前模型请求，请检查部署配置',
      503,
      correlationId,
      false
    );
  }
  if (
    error instanceof LlmUsageBudgetError ||
    (error instanceof LlmError && error.code === 'llm_budget_exceeded')
  ) {
    return providerErrorResponse(
      'llm_budget_exceeded',
      '模型请求超出已配置预算或用量无法安全核算；当前操作已停止，请检查预算与用量记录',
      429,
      correlationId,
      false
    );
  }
  if (error instanceof LlmError) {
    if (error.code === 'llm_response_too_large') {
      return providerErrorResponse(
        'llm_response_too_large',
        '模型响应超过读取资源上限，当前操作已停止；请检查请求或模型配置',
        502,
        correlationId,
        false
      );
    }
    const status =
      error.code === 'llm_upstream_error' && error.status && error.status < 500 ? 502 : 503;
    return providerErrorResponse(
      'llm_upstream_unavailable',
      '模型服务暂不可用，请稍后重试',
      status,
      correlationId,
      status === 503
    );
  }
  // Unexpected errors may contain credentials in messages, stacks or causes.
  // Keep the response/log correlation without forwarding the untrusted object.
  console.error('[api] unhandled error', { code: 'internal_error', correlationId });
  return NextResponse.json(
    {
      error: {
        code: 'internal_error',
        message: '服务暂时不可用，请稍后重试',
        correlationId
      }
    },
    { status: 500, headers: { 'x-correlation-id': correlationId } }
  );
}

function providerErrorResponse(
  code: string,
  message: string,
  status: number,
  correlationId: string,
  retryable: boolean
) {
  const headers: Record<string, string> = { 'x-correlation-id': correlationId };
  if (retryable) headers['retry-after'] = '60';
  return NextResponse.json({ error: { code, message, correlationId } }, { status, headers });
}

export function jsonError(message: string, code: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

const SAFE_MESSAGES: Record<string, string> = {
  legacy_time_cursor:
    '此版本使用完整日期顺序；请用 version 和 atEvent 选择时刻，不要沿用旧数字 at 游标',
  invalid_time_cursor: '请只提供一个有效的事件锚点或有限数字时间游标',
  ambiguous_latest_event: '事件日期不足以确定唯一最新时刻，请补充日期或手动选择光标事件',
  event_not_found: '该版本中找不到所选事件，请重新选择时间光标',
  invalid_json: '请求体不是有效 JSON',
  invalid_url: 'URL 不符合安全要求',
  url_fetch_failed: '远程页面抓取失败',
  document_parse_failed: '文档解析失败',
  unsupported_media_type: '暂不支持该文件类型',
  payload_too_large: '请求内容超过大小限制',
  internal_error: '服务暂时不可用，请稍后重试'
};

function publicMessage(code: string): string {
  return SAFE_MESSAGES[code] ?? `请求无法处理（${code}）`;
}

export async function readJsonBody(
  request: Request,
  maxBytes: number,
  options: { allowEmpty?: boolean } = {}
): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > maxBytes) {
    throw new GovernanceError('payload_too_large', 'Request body exceeds the size limit');
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new GovernanceError('payload_too_large', 'Request body exceeds the size limit');
  }
  if (!raw.trim() && options.allowEmpty) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new GovernanceError('invalid_json', 'Request body is not valid JSON');
  }
}

export async function readTextBody(request: Request, maxBytes: number): Promise<string> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > maxBytes) {
    throw new GovernanceError('payload_too_large', 'Request body exceeds the size limit');
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new GovernanceError('payload_too_large', 'Request body exceeds the size limit');
  }
  return raw;
}
