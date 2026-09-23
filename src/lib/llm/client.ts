import { getCredential, getDefaultProfileId, getProfile, type LlmProfile } from './config';

/**
 * Thin OpenAI-compatible chat client over locked profiles.
 *
 * Only two upstream calls exist by design:
 *  - `chat()`  → POST {baseUrl}/chat/completions
 *  - `detect()`→ GET  {baseUrl}/models   (connectivity probe for /health)
 *
 * Errors are structured (`LlmError`) so callers can degrade explicitly:
 * compile/continuation features stop; browsing/editing/retrieval never do.
 */

export class LlmError extends Error {
  readonly code:
    | 'llm_profile_unknown'
    | 'llm_credential_missing'
    | 'llm_upstream_error'
    | 'llm_empty_completion'
    | 'llm_timeout'
    | 'llm_invalid_response';
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly profileId: string;

  constructor(
    code: LlmError['code'],
    profileId: string,
    message: string,
    options?: { status?: number; retryAfterMs?: number }
  ) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.profileId = profileId;
    this.status = options?.status;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  profileId?: string | null;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResult {
  content: string;
  profileId: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  latencyMs: number;
}

type ChatCompletionUsage = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
};

export interface DetectResult {
  profileId: string;
  configured: boolean;
  detected: boolean;
  model: string;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
}

const DETECT_TIMEOUT_MS = 5_000;
const DETECT_CACHE_TTL_MS = 60_000;

const detectCache = new Map<string, { at: number; result: DetectResult }>();

/** Clear cached detections (used after credential/config changes and in tests). */
export function resetDetectCache(): void {
  detectCache.clear();
}

function endpoint(baseUrl: string, suffix: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return base.endsWith(suffix) ? base : `${base}${suffix}`;
}

function authHeaders(profile: LlmProfile): HeadersInit {
  const key = getCredential(profile);
  return {
    'content-type': 'application/json',
    ...(key ? { authorization: `Bearer ${key}` } : {})
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  const seconds = header ? Number(header) : NaN;
  return Number.isFinite(seconds) ? Math.min(60_000, seconds * 1_000) : undefined;
}

async function chatOnce(
  profile: LlmProfile,
  request: ChatRequest,
  apiKeyConfigured: boolean
): Promise<{
  content: string;
  usage: ChatResult['usage'];
}> {
  if (!apiKeyConfigured) {
    throw new LlmError(
      'llm_credential_missing',
      profile.id,
      `Credential env "${profile.credentialEnv}" is not set for profile "${profile.id}"`
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), profile.timeoutMs);
  let response: Response;
  try {
    response = await fetch(endpoint(profile.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: authHeaders(profile),
      body: JSON.stringify({
        model: profile.model,
        messages: request.messages,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {})
      }),
      signal: controller.signal
    });
  } catch {
    if (controller.signal.aborted) {
      throw new LlmError(
        'llm_timeout',
        profile.id,
        `Profile "${profile.id}" timed out after ${profile.timeoutMs}ms`
      );
    }
    throw new LlmError('llm_upstream_error', profile.id, `Profile "${profile.id}" request failed`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    await response.text().catch(() => '');
    throw new LlmError(
      'llm_upstream_error',
      profile.id,
      `Profile "${profile.id}" returned HTTP ${response.status}`,
      { status: response.status, retryAfterMs: retryAfterMs(response) }
    );
  }

  let payload: {
    choices?: { message?: { content?: string } }[];
    usage?: ChatCompletionUsage;
  };
  try {
    payload = await response.json();
  } catch {
    throw new LlmError(
      'llm_invalid_response',
      profile.id,
      `Profile "${profile.id}" returned non-JSON body`
    );
  }
  const content = payload.choices?.[0]?.message?.content ?? '';
  if (!String(content).trim()) {
    throw new LlmError(
      'llm_empty_completion',
      profile.id,
      `Profile "${profile.id}" returned HTTP 200 with 0 output tokens`
    );
  }
  return { content, usage: normalizeUsage(payload.usage) };
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * OpenAI-compatible providers use both the legacy prompt/completion names and
 * the newer input/output names. Preserve usage only when both sides are
 * present and valid; partial data must remain null so budget checks fail closed.
 */
function normalizeUsage(usage: ChatCompletionUsage | undefined): ChatResult['usage'] {
  if (!usage) return null;
  const inputTokens = nonNegativeInteger(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = nonNegativeInteger(usage.completion_tokens ?? usage.output_tokens);
  if (inputTokens === null || outputTokens === null) return null;
  return { inputTokens, outputTokens };
}

/** Run one chat completion against a locked profile, with bounded retries. */
export async function chat(request: ChatRequest): Promise<ChatResult> {
  const profile = getProfile(request.profileId);
  const apiKeyConfigured = getCredential(profile) !== null;
  const startedAt = Date.now();
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= profile.maxRetries; attempt += 1) {
    if (attempt > 0) await sleep(800 * attempt);
    try {
      const result = await chatOnce(profile, request, apiKeyConfigured);
      return {
        content: result.content,
        profileId: profile.id,
        model: profile.model,
        usage: result.usage,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof LlmError &&
        (error.code === 'llm_empty_completion' ||
          error.code === 'llm_timeout' ||
          (error.code === 'llm_upstream_error' &&
            ((error.status ?? 0) === 429 || (error.status ?? 0) >= 500)));
      if (!retryable) break;
    }
  }
  throw lastError;
}

/** Connectivity probe against {baseUrl}/models, cached for 60s per profile. */
export async function detect(profileId?: string | null): Promise<DetectResult> {
  const profile = getProfile(profileId);
  const cached = detectCache.get(profile.id);
  if (cached && Date.now() - cached.at < DETECT_CACHE_TTL_MS) {
    return cached.result;
  }

  const configured = getCredential(profile) !== null;
  const result: DetectResult = {
    profileId: profile.id,
    configured,
    detected: false,
    model: profile.model,
    latencyMs: null,
    error: null,
    checkedAt: new Date().toISOString()
  };

  if (!configured) {
    result.error = `credential env "${profile.credentialEnv}" is not set`;
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
      const response = await fetch(endpoint(profile.baseUrl, '/models'), {
        headers: authHeaders(profile),
        signal: controller.signal
      });
      result.latencyMs = Date.now() - startedAt;
      if (response.ok) {
        result.detected = true;
      } else {
        result.error = `GET /models returned ${response.status}`;
      }
    } catch {
      result.latencyMs = Date.now() - startedAt;
      result.error = controller.signal.aborted
        ? `probe timed out after ${DETECT_TIMEOUT_MS}ms`
        : 'probe failed';
    } finally {
      clearTimeout(timer);
    }
  }

  detectCache.set(profile.id, { at: Date.now(), result });
  return result;
}

/** Default profile id, re-exported for the health endpoint. */
export const defaultProfileId = getDefaultProfileId;
